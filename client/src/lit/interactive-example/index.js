import { html, LitElement } from "lit";
import { ref, createRef } from "lit/directives/ref.js";
import "../play/editor.js";
import "../play/controller.js";
import "../play/console.js";
import "../play/runner.js";
import { GleanMixin } from "../glean-mixin.js";
import "./tabs.js";
import { decode } from "he";
import init, { watify } from "watify";

import styles from "./index.scss?css" with { type: "css" };

import exampleJs from "./example.js?raw";
import exampleStyle from "./example.css?raw";

/**
 * @import { Ref } from 'lit/directives/ref.js';
 * @import { PlayController } from "../play/controller.js";
 * @import { PlayRunner } from "../play/runner.js";
 */

/**
 * compiles the wat code to wasm
 * @param {string} wat
 * @returns {Promise<string>} a data-url with the compiled wasm, base64 encoded
 */
async function compileAndEncodeWat(wat) {
  await init();
  const binary = watify(wat);
  const b64 = `data:application/wasm;base64,${binary.toBase64()}`;
  return b64;
}

export class InteractiveExample extends GleanMixin(LitElement) {
  static properties = {
    name: { type: String },
    _languages: { state: true },
  };

  static styles = styles;

  constructor() {
    super();
    this.name = "";
    /** @type {string[]} */
    this._languages = [];
    /** @type {Object<string, string>} */
    this._code = {};
  }

  /** @type {Ref<PlayController>} */
  _controller = createRef();
  /** @type {Ref<PlayRunner>} */
  _runner = createRef();

  _run() {
    this._controller.value?.run();
  }

  _reset() {
    this._controller.value?.reset();
  }

  _initialCode() {
    const exampleNodes = this.closest("section")?.querySelectorAll(
      ".code-example pre[class*=interactive-example]"
    );
    const code = Array.from(exampleNodes || []).reduce((acc, pre) => {
      const language = pre.classList[1];
      return language && pre.textContent
        ? {
            ...acc,
            [language]: acc[language]
              ? `${acc[language]}\n${pre.textContent}`
              : pre.textContent,
          }
        : acc;
    }, /** @type {Object<string, string>} */ ({}));
    this._languages = Object.keys(code);
    // TODO: only if html example
    // TODO: breaks imports
    code["js-hidden"] = exampleJs;
    code["css-hidden"] = exampleStyle;
    if ("wat" in code) {
      const js = code.js;
      code.js = `window.parent.postMessage({ typ: "ready" }, "*");
window.addEventListener("message", ({ data }) => {
  console.log("message!", data);
  if (data.typ === "watUrl") {
    const watUrl = data.watUrl;
    console.log("watUrl!", watUrl);
    const js = data.js;
    const newJs = js.replaceAll("{%wasm-url%}", watUrl);
    const script = document.createElement("script")
    script.setAttribute("type", "module")
    script.innerHTML = newJs
    document.body.appendChild(script)
  }
});
console.log("hello!");
`;
      compileAndEncodeWat(code.wat).then((watUrl) => {
        console.log("compiled", watUrl);

        window.addEventListener("message", ({ data: { typ } }) => {
          if (typ === "ready") {
            console.log("ready!");
            const iframe =
              this._runner.value?.shadowRoot?.querySelector("iframe");
            iframe?.contentWindow?.postMessage(
              { typ: "watUrl", watUrl, js },
              "*"
            );
          }
        });
      });
    }
    return code;
  }

  /**
   * @param {string} lang
   */
  _langName(lang) {
    switch (lang) {
      case "html":
        return "HTML";
      case "css":
        return "CSS";
      case "js":
        return "JavaScript";
      default:
        return lang;
    }
  }

  /** @param {Event} ev  */
  _telemetryHandler(ev) {
    let action = ev.type;
    if (
      ev.type === "click" &&
      ev.target instanceof HTMLElement &&
      ev.target.id
    ) {
      action = `click@${ev.target.id}`;
    }
    this._gleanClick(`interactive-examples-lit: ${action}`);
  }

  connectedCallback() {
    super.connectedCallback();
    this._telemetryHandler = this._telemetryHandler.bind(this);
    this.renderRoot.addEventListener("focus", this._telemetryHandler);
    this.renderRoot.addEventListener("copy", this._telemetryHandler);
    this.renderRoot.addEventListener("cut", this._telemetryHandler);
    this.renderRoot.addEventListener("paste", this._telemetryHandler);
    this.renderRoot.addEventListener("click", this._telemetryHandler);
    this._code = this._initialCode();
  }

  render() {
    return this._languages.length === 1 && this._languages[0] === "js"
      ? html`
          <play-controller ${ref(this._controller)}>
            <div class="template-javascript">
              <header>
                <h4>${decode(this.name)}</h4>
              </header>
              <play-editor id="editor" language="js"></play-editor>
              <div class="buttons">
                <button id="execute" @click=${this._run}>Run</button>
                <button id="reset" @click=${this._reset}>Reset</button>
              </div>
              <play-console id="console"></play-console>
              <play-runner></play-runner>
            </div>
          </play-controller>
        `
      : html`
          <play-controller ${ref(this._controller)} run-on-start run-on-change>
            <div class="template-tabbed">
              <header>
                <h4>${decode(this.name)}</h4>
                <button id="reset" @click=${this._reset}>Reset</button>
              </header>
              <tab-wrapper>
                ${this._languages.map(
                  (lang) => html`
                    <tab-tab>${this._langName(lang)}</tab-tab>
                    <tab-panel>
                      <play-editor language=${lang}></play-editor>
                    </tab-panel>
                  `
                )}
              </tab-wrapper>
              <div class="output-wrapper">
                <h4>Output</h4>
                <play-runner
                  ${ref(this._runner)}
                  sandbox="allow-top-navigation-by-user-activation"
                ></play-runner>
              </div>
            </div>
          </play-controller>
        `;
  }

  firstUpdated() {
    if (this._controller.value) {
      this._controller.value.code = this._code;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.renderRoot.removeEventListener("focus", this._telemetryHandler);
    this.renderRoot.removeEventListener("copy", this._telemetryHandler);
    this.renderRoot.removeEventListener("cut", this._telemetryHandler);
    this.renderRoot.removeEventListener("paste", this._telemetryHandler);
    this.renderRoot.removeEventListener("click", this._telemetryHandler);
  }
}

customElements.define("interactive-example", InteractiveExample);
