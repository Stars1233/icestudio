'use strict';

class WafleWindowManager {
  constructor() {
    this.windows = {};
    this.init();
  }

  _registerWindowDragAndDrop() {
    function draggableFilter(e) {
      if (!e.target.classList.contains('ics-wm__is-draggable')) {
        return;
      }

      // Drag the element with id indexed by dragcontainerid attribute, should be a parent container
      let dragContainer = e.target.getAttribute('data-dragcontainerid');
      let target = iceStudio.gui.el(dragContainer);
      // Don't allow dragging minimized windows
      if (target.classList.contains('ics-wm-window--minimized')) {
        return;
      }
      target.moving = true;

      //-- First check if mouse input exists, if not , we suppose you have a touch input
      if (e.clientX) {
        target.oldX = e.clientX;
        target.oldY = e.clientY;
      } else {
        //-- Use the 0 index for the first touch, for the momment we dont use multiple touchs
        target.oldX = e.touches[0].clientX;
        target.oldY = e.touches[0].clientY;
      }

      target.oldLeft =
        window
          .getComputedStyle(target)
          .getPropertyValue('left')
          .split('px')[0] * 1;
      target.oldTop =
        window.getComputedStyle(target).getPropertyValue('top').split('px')[0] *
        1;

      // Update Ton drag
      document.onmousemove = dragUpdate;
      document.ontouchmove = dragUpdate;

      function dragUpdate(event) {
        event.preventDefault();

        if (!target.moving) {
          return;
        }
        if (event.clientX) {
          target.distX = event.clientX - target.oldX;
          target.distY = event.clientY - target.oldY;
        } else {
          target.distX = event.touches[0].clientX - target.oldX;
          target.distY = event.touches[0].clientY - target.oldY;
        }
        target.style.left = target.oldLeft + target.distX + 'px';
        target.style.top = target.oldTop + target.distY + 'px';
        // Preserve current size if already set in pixels, otherwise use default
        if (!target.style.width || target.style.width.indexOf('calc') >= 0) {
          target.style.width = '180px';
          target.style.height = '450px';
        }
      }

      function endDrag() {
        target.moving = false;
      }
      target.onmouseup = endDrag;
      target.ontouchend = endDrag;
    }
    document.onmousedown = draggableFilter;
    document.ontouchstart = draggableFilter;
  }

  _registerWindowResize() {
    let resizing = false;
    let resizeTarget = null;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    document.addEventListener('mousedown', function (e) {
      if (!e.target.classList.contains('ics-wm-window--resize-handle')) {
        return;
      }
      e.preventDefault();
      resizeTarget = e.target.closest('.ics-wm-window');
      if (!resizeTarget) {
        return;
      }
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = resizeTarget.offsetWidth;
      startH = resizeTarget.offsetHeight;
    });

    document.addEventListener('mousemove', function (e) {
      if (!resizing || !resizeTarget) {
        return;
      }
      e.preventDefault();
      var newW = Math.max(200, startW + (e.clientX - startX));
      var newH = Math.max(150, startH + (e.clientY - startY));
      resizeTarget.style.width = newW + 'px';
      resizeTarget.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', function () {
      resizing = false;
      resizeTarget = null;
    });
  }

  init() {
    this._registerWindowDragAndDrop();
    this._registerWindowResize();
    this._registerMinimizedRestore();
  }

  _registerMinimizedRestore() {
    let _this = this;
    document.addEventListener('click', function (e) {
      let minimizedWin = e.target.closest('.ics-wm-window--minimized');
      if (minimizedWin) {
        let id = minimizedWin.id;
        if (_this.windows[id]) {
          _this.restoreWindow(id);
        }
      }
    });
  }

  addWindow(title, id, options) {
    if (typeof options === 'undefined') {
      options = {};
    }
    if (typeof this.windows[id] === 'undefined') {
      let _this = this;
      let winParams = {
        id: id,
        title: options.title ? title : '',
        top: '30px',
        bottom: '48px',
        htmlClass: 'ics-wm-window',
        minimizable: options.minimizable || false,
      };
      if (options.width) {
        winParams.width = options.width;
      }
      if (options.height) {
        winParams.height = options.height;
      }
      if (options.resizable) {
        winParams.resizable = true;
      }
      this.windows[id] = new WafleUIWindow(winParams);
      let buttonClose = iceStudio.gui.el(`#${id} .ics-wm-window__close`);
      function closeWindowByPointer(e) {
        let targetId = false;
        targetId = e.target.getAttribute('data-winid');
        if (targetId === false || targetId === null || targetId === '')
          return false;

        let buttonClose = iceStudio.gui.el(`${targetId} .ics-wm-window__close`);
        for (let i = 0; i < buttonClose.length; i++) {
          buttonClose[i].removeEventListener(
            'click',
            closeWindowByPointer,
            true
          );
        }
        const id = targetId.replace('#', '');
        _this.closeWindow(id);
      }
      for (let i = 0; i < buttonClose.length; i++) {
        buttonClose[i].removeEventListener('click', closeWindowByPointer, true);
        buttonClose[i].addEventListener('click', closeWindowByPointer, true);
      }

      // Register minify button handler
      let buttonMinify = iceStudio.gui.el(`#${id} .ics-wm-window__minify`);
      for (let i = 0; i < buttonMinify.length; i++) {
        buttonMinify[i].addEventListener(
          'click',
          function (e) {
            e.stopPropagation();
            let targetId = e.target.getAttribute('data-winid');
            if (!targetId) return;
            const winId = targetId.replace('#', '');
            _this.minimizeWindow(winId);
          },
          true
        );
      }
    }
  }

  minimizeWindow(id) {
    let win = this.windows[id];
    if (!win) return;
    let el = win.dom;
    // Capture actual pixel dimensions before transforming
    let origW = el.offsetWidth;
    let origH = el.offsetHeight;
    // Store original styles for restore
    win.originalStyles = {
      top: el.style.top,
      right: el.style.right,
      left: el.style.left,
      bottom: el.style.bottom,
      width: el.style.width,
      height: el.style.height,
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
    };
    win.minimized = true;
    el.classList.add('ics-wm-window--minimized');
    // Keep original dimensions so content renders fully
    el.style.width = origW + 'px';
    el.style.height = origH + 'px';
    // Scale down to 92x69 thumbnail
    let scaleX = 92 / origW;
    let scaleY = 69 / origH;
    el.style.transformOrigin = 'bottom left';
    el.style.transform = 'scale(' + scaleX + ', ' + scaleY + ')';
    // Position at bottom-left
    el.style.top = 'auto';
    el.style.right = 'auto';
    el.style.bottom = '48px';
    el.style.left = '10px';
  }

  restoreWindow(id) {
    let win = this.windows[id];
    if (!win || !win.originalStyles) return;
    let el = win.dom;
    win.minimized = false;
    el.classList.remove('ics-wm-window--minimized');
    el.classList.remove('ics-wm-window--notify');
    Object.assign(el.style, win.originalStyles);
  }

  closeWindow(id) {
    iceStudio.bus.events.publish(`${id}::Terminate`, false, id);
    this.windows[id].close();
    delete this.windows[id];
  }
}
