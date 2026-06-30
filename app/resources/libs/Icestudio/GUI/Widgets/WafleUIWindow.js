'use strict';
class WafleUIWindow {
  constructor(params) {
    if (typeof params.html === 'undefined') {
      params.html = '';
    }
    if (typeof params.y === 'undefined') {
      params.y = '70px';
    }
    if (typeof params.right === 'undefined') {
      params.right = '0px'; //CM window sticked to the rigth side of icestudio window
    }
    if (typeof params.width === 'undefined') {
      params.width = 'calc(7% + 150px)'; //adjust size of CM window with icestudio window size
    }
    if (typeof params.height === 'undefined') {
      params.height = 'calc(100% - 118px)';
    }
    if (typeof params.resizable === 'undefined') {
      params.resizable = false;
    }
    if (typeof params.title === 'undefined') {
      params.title = '';
    }
    if (typeof params.minimizable === 'undefined') {
      params.minimizable = false;
    }

    /*-- ¡¡ Be careful !!
        -- If you modify x and - symbols, check that is consisteng with all OS fonts , in this momment we use unicode symbol that is universal and not consume resources.
        -- For the future we could change by svg image for the icons.
        -- */
    this.winId = params.id;
    this.resizable = params.resizable;
    let resizeHandle = params.resizable
      ? '<div class="ics-wm-window--resize-handle"></div>'
      : '';
    let titleHtml = params.title
      ? `<span class="ics-wm-window--topbar--title ics-wm__is-draggable" data-dragcontainerid="#${params.id}">${params.title}</span>`
      : '';
    let minifyButton = params.minimizable
      ? `<div class="ics-wm-window--topbar--button | ics-wm-window__minify" data-winid="#${params.id}">-</div>`
      : '';
    let content = `<div class="ics-wm-window--topbar | ics-wm__is-draggable" data-dragcontainerid="#${params.id}">
        <div class="ics-wm-window--topbar--button | ics-wm-window__close" data-winid="#${params.id}">x</div>
        ${minifyButton}${titleHtml}</div>
        <div class="ics-wm-window--body"></div>
        <div class="ics-wm-window--bottombar"></div>${resizeHandle}`;

    this.dom = iceStudio.gui.addDiv(params.id, params.htmlClass, content);
    this.dom.style.top = params.y;
    this.dom.style.right = params.right;
    this.dom.style.width = params.width;
    this.dom.style.height = params.height;
    iceStudio.bus.events.subscribe(`Navigation::ReadOnly`, 'hide', this);
    iceStudio.bus.events.subscribe(`Navigation::ReadWrite`, 'show', this);
  }

  hide() {
    this.dom.style.display = 'none';
  }

  show() {
    this.dom.style.display = 'block';
  }

  close() {
    iceStudio.gui.removeDiv(`#${this.winId}`);
  }
}
