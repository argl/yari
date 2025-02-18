import { html, LitElement } from "lit";

import wrapperStyles from "./tabs.wrapper.scss?css" with { type: "css" };
import tabStyles from "./tabs.tab.scss?css" with { type: "css" };
import panelStyles from "./tabs.panel.scss?css" with { type: "css" };

export class TabWrapper extends LitElement {
  static styles = wrapperStyles;

  /** @param {MouseEvent} ev  */
  _tabClick({ target }) {
    if (target instanceof HTMLElement) {
      const tab = target.closest("tab-tab");
      this.querySelectorAll("tab-tab").forEach((n) =>
        n.classList.remove("active")
      );
      tab?.classList.add("active");
      const panel = tab?.nextElementSibling;
      this.querySelectorAll("[slot=active-panel]").forEach((n) =>
        n.removeAttribute("slot")
      );
      panel?.setAttribute("slot", "active-panel");
    }
  }

  render() {
    return html`
      <div id="tablist">
        <slot name="tab" @click=${this._tabClick}></slot>
      </div>
      <slot name="active-panel"></slot>
    `;
  }

  firstUpdated() {
    this.querySelector("tab-tab")?.click();
  }
}

customElements.define("tab-wrapper", TabWrapper);

export class TabTab extends LitElement {
  static styles = tabStyles;

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("slot", "tab");
  }

  render() {
    return html`<slot></slot>`;
  }
}

customElements.define("tab-tab", TabTab);

export class TabPanel extends LitElement {
  static styles = panelStyles;

  connectedCallback() {
    super.connectedCallback();
  }

  render() {
    return html`<slot></slot>`;
  }
}

customElements.define("tab-panel", TabPanel);
