/**
@license
Copyright 2018 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import {addHasRemoveClass, FormElement} from '@material/mwc-base/form-element';
import {observer} from '@material/mwc-base/observer';
import {SingleSelectionController} from '@material/mwc-radio/single-selection-controller';
import {Ripple} from '@material/mwc-ripple/mwc-ripple';
import {RippleHandlers} from '@material/mwc-ripple/ripple-handlers';
import {MDCRadioAdapter} from '@material/radio/adapter';
import MDCRadioFoundation from '@material/radio/foundation';
import {eventOptions, html, internalProperty, property, query, queryAsync} from 'lit-element';
import {classMap} from 'lit-html/directives/class-map';


/**
 * @fires checked
 * @soyCompatible
 */
export class RadioBase extends FormElement {
  @query('.mdc-radio') protected mdcRoot!: HTMLElement;

  @query('input') protected formElement!: HTMLInputElement;

  private _checked = false;

  @property({type: Boolean}) global = false;

  @property({type: Boolean, reflect: true})
  get checked() {
    return this._checked;
  }

  /**
   * We define our own getter/setter for `checked` because we need to track
   * changes to it synchronously.
   *
   * The order in which the `checked` property is set across radio buttons
   * within the same group is very important. However, we can't rely on
   * UpdatingElement's `updated` callback to observe these changes (which is
   * also what the `@observer` decorator uses), because it batches changes to
   * all properties.
   *
   * Consider:
   *
   *   radio1.disabled = true;
   *   radio2.checked = true;
   *   radio1.checked = true;
   *
   * In this case we'd first see all changes for radio1, and then for radio2,
   * and we couldn't tell that radio1 was the most recently checked.
   */
  set checked(isChecked: boolean) {
    const oldValue = this._checked;
    if (isChecked === oldValue) {
      return;
    }
    this._checked = isChecked;
    if (this.formElement) {
      this.formElement.checked = isChecked;
    }
    this.updateSelection();

    // If programatically toggled hide the ripple.
    if (isChecked === false) {
      this.blur();
    }
    this.requestUpdate('checked', oldValue);

    // useful when unchecks self and wrapping element needs to synchronize
    // TODO(b/168543810): Remove triggering event on programmatic API call.
    this.dispatchEvent(new Event('checked', {bubbles: true, composed: true}));
  }

  @property({type: Boolean})
  @observer(function(this: RadioBase, disabled: boolean) {
    this.mdcFoundation.setDisabled(disabled);
  })
  disabled = false;

  @property({type: String})
  @observer(function(this: RadioBase, value: string) {
    this._handleUpdatedValue(value);
  })
  value = '';

  _handleUpdatedValue(newValue: string) {
    // the observer function can't access protected fields (according to
    // closure compiler) because it's not a method on the class, so we need this
    // wrapper.
    this.formElement.value = newValue;
  }

  @property({type: String}) name = '';

  /**
   * Touch target extends beyond visual boundary of a component by default.
   * Set to `true` to remove touch target added to the component.
   * @see https://material.io/design/usability/accessibility.html
   */
  @property({type: Boolean}) reducedTouchTarget = false;

  protected mdcFoundationClass = MDCRadioFoundation;

  protected mdcFoundation!: MDCRadioFoundation;

  private _selectionController?: SingleSelectionController;

  @internalProperty() protected formElementTabIndex = 0;

  @internalProperty() protected shouldRenderRipple = false;

  @queryAsync('mwc-ripple') ripple!: Promise<Ripple|null>;

  private rippleElement: Ripple|null = null;

  protected rippleHandlers: RippleHandlers = new RippleHandlers(() => {
    this.shouldRenderRipple = true;
    this.ripple.then((v) => {
      this.rippleElement = v;
    });

    return this.ripple;
  });

  /** @soyCompatible */
  protected renderRipple() {
    return this.shouldRenderRipple ?
        html`<mwc-ripple unbounded accent .disabled="${
            this.disabled}"></mwc-ripple>` :
        '';
  }

  get isRippleActive() {
    return this.rippleElement?.isActive || false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Note that we must defer creating the selection controller until the
    // element has connected, because selection controllers are keyed by the
    // radio's shadow root. For example, if we're stamping in a lit-html map
    // or repeat, then we'll be constructed before we're added to a root node.
    //
    // Also note if we aren't using native shadow DOM, we still need a
    // SelectionController, because we should update checked status of other
    // radios in the group when selection changes. It also simplifies
    // implementation and testing to use one in all cases.
    //
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    this._selectionController = SingleSelectionController.getController(this);
    this._selectionController.register(this);

    // Radios maybe checked before connected, update selection as soon it is
    // connected to DOM. Last checked radio button in the DOM will be selected.
    this.updateSelection();
  }

  disconnectedCallback() {
    // The controller is initialized in connectedCallback, so if we are in
    // disconnectedCallback then it must be initialized.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this._selectionController!.unregister(this);
    this._selectionController = undefined;
  }

  focus() {
    this.formElement?.focus();
  }

  blur() {
    this.formElement?.blur();
  }

  protected createAdapter(): MDCRadioAdapter {
    return {
      ...addHasRemoveClass(this.mdcRoot),
      setNativeControlDisabled: (disabled: boolean) => {
        this.formElement.disabled = disabled;
      },
    };
  }

  private handleFocus() {
    this.handleRippleFocus();
  }

  private handleClick() {
    // Firefox has weird behavior with radios if they are not focused
    this.focus();
  }

  private handleBlur() {
    this.blur();
    this.rippleHandlers.endFocus();
  }

  /**
   * @return Returns tabindex based on checked status of input. Only checked
   *     input receives tab focus. If none of radios are checked then set tab
   *     focus to all input to let browser decide which radio to receive focus
   *     in the group.
   */
  private getTabIndex(): number {
    // If none of the radio buttons are checked in group include all radios in
    // tab navigation. This'll let browser decide where to land the focus.
    // By default browser lands focus on the leading radio based on keyboard tab
    // direction.
    if (!this._selectionController?.isAnySelected(this)) {
      return 0;
    }

    // When tabbing through land focus on the checked radio in the group.
    if (this.checked) {
      return 0;
    }

    return -1;
  }

  private updateSelection() {
    if (this._selectionController) {
      this._selectionController.update(this);
    }

    this.formElementTabIndex = this.getTabIndex();
  }

  /**
   * @soyCompatible
   * @soyAttributes radioAttributes: input
   * @soyClasses radioClasses: .mdc-radio
   */
  protected render() {
    /** @classMap */
    const classes = {
      'mdc-radio--touch': !this.reducedTouchTarget,
      'mdc-radio--disabled': this.disabled,
    };

    return html`
      <div class="mdc-radio ${classMap(classes)}">
        <input
          tabindex="${this.formElementTabIndex}"
          class="mdc-radio__native-control"
          type="radio"
          name="${this.name}"
          .checked="${this.checked}"
          .value="${this.value}"
          ?disabled="${this.disabled}"
          @change="${this.changeHandler}"
          @focus="${this.handleFocus}"
          @click="${this.handleClick}"
          @blur="${this.handleBlur}"
          @mousedown="${this.handleRippleMouseDown}"
          @mouseenter="${this.handleRippleMouseEnter}"
          @mouseleave="${this.handleRippleMouseLeave}"
          @touchstart="${this.handleRippleTouchStart}"
          @touchend="${this.handleRippleDeactivate}"
          @touchcancel="${this.handleRippleDeactivate}">
        <div class="mdc-radio__background">
          <div class="mdc-radio__outer-circle"></div>
          <div class="mdc-radio__inner-circle"></div>
        </div>
        ${this.renderRipple()}
      </div>`;
  }

  protected handleRippleMouseDown(event: Event) {
    const onUp = () => {
      window.removeEventListener('mouseup', onUp);

      this.handleRippleDeactivate();
    };

    window.addEventListener('mouseup', onUp);
    this.rippleHandlers.startPress(event);
  }

  @eventOptions({passive: true})
  protected handleRippleTouchStart(event: Event) {
    this.rippleHandlers.startPress(event);
  }

  protected handleRippleDeactivate() {
    this.rippleHandlers.endPress();
  }

  protected handleRippleMouseEnter() {
    this.rippleHandlers.startHover();
  }

  protected handleRippleMouseLeave() {
    this.rippleHandlers.endHover();
  }

  protected handleRippleFocus() {
    this.rippleHandlers.startFocus();
  }

  protected changeHandler() {
    this.checked = this.formElement.checked;
  }
}
