'use strict';
/* jshint unused:false */
function placementCssIOTasks(data, bbox, state, queue) {
  /* jshint validthis: true */
  let virtualtopOffset = 24;
  let i = 0;
  let bx = Math.round(bbox.x * state.zoom + state.pan.x);
  let by = Math.round(bbox.y * state.zoom + state.pan.y);
  let bx0 = bx;
  let by0 = by;
  let bw = bbox.width;
  let bh = bbox.height;
  let fpgaTopOffset = data.name || data.range || data.clock ? 0 : 24;

  if (typeof this.nativeDom.box.dataset.osize === 'undefined') {
    this.nativeDom.box.dataset.osize = `w:${bw}|h:${bh}`;
    // Render block
    queue.push({
      e: this.nativeDom.box,
      property: 'left',
      value: 0,
    });
    queue.push({
      e: this.nativeDom.box,
      property: 'top',
      value: 0,
    });
    queue.push({
      e: this.nativeDom.box,
      property: 'width',
      value: bw + 'px',
    });
    queue.push({
      e: this.nativeDom.box,
      property: 'height',
      value: bh + 'px',
    });
    queue.push({
      e: this.nativeDom.box,
      property: 'transform-origin',
      value: '0 0',
    });
    bx = Math.round((bbox.width / 2.0) * (state.zoom - 1));
    by = Math.round(
      ((bbox.height - virtualtopOffset) / 2.0) * (state.zoom - 1) +
        (virtualtopOffset / 2.0) * state.zoom
    );
    bw = bbox.width;
    bh = Math.round(bbox.height - virtualtopOffset);

    for (i = 0; i < this.nativeDom.virtualContentSelector.length; i++) {
      queue.push({
        e: this.nativeDom.virtualContentSelector[i],
        property: 'left',
        value: 0,
      });
      queue.push({
        e: this.nativeDom.virtualContentSelector[i],
        property: 'top',
        value: '20%',
      });
      queue.push({
        e: this.nativeDom.virtualContentSelector[i],
        property: 'width',
        value: bw + 'px',
      });
      queue.push({
        e: this.nativeDom.virtualContentSelector[i],
        property: 'height',
        value: bh + 'px',
      });
    }
  }

  bh = Math.round(bbox.height - fpgaTopOffset);
  // Render io FPGA content
  for (i = 0; i < this.nativeDom.fpgaContentSelector.length; i++) {
    queue.push({
      e: this.nativeDom.fpgaContentSelector[i],
      property: 'left',
      value: 0,
    });
    queue.push({
      e: this.nativeDom.fpgaContentSelector[i],
      property: 'top',
      value: 0,
    });
    queue.push({
      e: this.nativeDom.fpgaContentSelector[i],
      property: 'width',
      value: bw + 'px',
    });
    queue.push({
      e: this.nativeDom.fpgaContentSelector[i],
      property: 'height',
      value: bh + 'px',
    });
  }

  queue.push({
    e: this.nativeDom.box,
    property: 'transform',
    value: `translate3d(${bx0}px,${by0}px,0) scale( ${state.zoom})`,
  });

  if (data.name || data.range || data.clock) {
    this.headerSelector.removeClass('hidden');
  } else {
    this.headerSelector.addClass('hidden');
  }
  i = queue.length;
  for (i = 0; i < queue.length; i++) {
    if (queue[i].e !== null) {
      queue[i].e.style[queue[i].property] = queue[i].value;
    }
  }

  return queue;
}

function placementCssTasks(selector, bbox, state, queue) {
  /* jshint validthis: true */
  let i = 0;
  let bw = Math.round(bbox.width);
  let bh = Math.round(bbox.height);
  let bx = Math.round(bbox.x * state.zoom + state.pan.x);
  let by = Math.round(bbox.y * state.zoom + state.pan.y);

  if (typeof this.$box[0].dataset.osize === 'undefined') {
    queue.push({
      e: this.$box[0],
      property: 'left',
      value: 0,
    });
    queue.push({
      e: this.$box[0],
      property: 'top',
      value: 0,
    });
    let gcontent = domCache[this.id + this.cid + selector];
    if (!gcontent) {
      gcontent = this.$box[0].querySelectorAll(selector);
      domCache[this.id + this.cid + selector] = gcontent;
    }
    // gcontent= this.$box[0].querySelectorAll(selector);

    for (i = 0; i < gcontent.length; i++) {
      queue.push({ e: gcontent[i], property: 'left', value: 0 });
      queue.push({ e: gcontent[i], property: 'top', value: 0 });

      queue.push({
        e: gcontent[i],
        property: 'height',
        value: bh + 'px',
      });
      queue.push({
        e: gcontent[i],
        property: 'width',
        value: bw + 'px',
      });
    }
    queue.push({
      e: this.$box[0],
      property: 'height',
      value: bh + 'px',
    });
    queue.push({
      e: this.$box[0],
      property: 'width',
      value: bw + 'px',
    });

    this.$box[0].dataset.osize = `w:${bw}|h:${bh}`;

    queue.push({
      e: this.$box[0],
      property: 'transform-origin',
      value: '0 0',
    });
  }
  queue.push({
    e: this.$box[0],
    property: 'transform',
    value: `translate3d(${bx}px,${by}px,0) scale( ${state.zoom})`,
  });

  function applyCSSChanges() {
    let i = queue.length;
    for (i = 0; i < queue.length; i++) {
      if (queue[i].e !== null) {
        queue[i].e.style[queue[i].property] = queue[i].value;
      }
    }
  }
  //requestAnimationFrame(applyCSSChanges);
  applyCSSChanges();

  return queue;
}

/* jshint unused:true */
