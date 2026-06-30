//-- When some change in the configuration or in the environment, launch it
function setupEnvironment(env) {
  iceStudio.bus.events.publish('collectionService.isIndexing');
}

let preload = false; //-- Flag for preload collection tree from database while indexing the new one.
let pollTimer = false; //-- Single pending poll timer (avoids stacking)
let filterQuery = ''; //-- Current real-time block filter text
let savedFoldState = null; //-- Folder open/closed state captured before filtering

//-- Schedule a single status poll (guarded so live pushes don't stack timers)
function schedulePoll() {
  if (pollTimer) {
    return;
  }
  pollTimer = setTimeout(function () {
    pollTimer = false;
    iceStudio.bus.events.publish('collectionService.isIndexing');
  }, 1000);
}

function cancelPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = false;
  }
}

//-- Show / hide the indexing status panel
function showStatus() {
  let st = iceStudio.gui.el('#cm2-status', pluginHost);
  if (st) {
    st.style.display = 'block';
  }
}

function hideStatus() {
  let st = iceStudio.gui.el('#cm2-status', pluginHost);
  if (st) {
    st.style.display = 'none';
  }
}

//-- Update the status panel with the current progress and the path being
//-- scanned, so the user can see, elegantly, what is happening.
function updateStatus(status, message) {
  showStatus();

  let msg = iceStudio.gui.el('.cm-loader--status', pluginHost);
  let pathEl = iceStudio.gui.el('.cm-loader--path', pluginHost);

  if (msg && msg.length) {
    let text = message || 'Indexing database';
    if (!message && status && status.total > 0) {
      text = 'Indexing ' + status.done + ' / ' + status.total;
    }
    msg[0].textContent = text;
  }

  if (pathEl && pathEl.length) {
    pathEl[0].textContent = status && status.current ? status.current : '';
  }
}

//-- When index event in the collection service fired
function collectionsIndexStatus(status) {
  if (status.queue === 0 && status.indexing === false) {
    cancelPoll();
    hideStatus();
    iceStudio.bus.events.publish('collectionService.getCollections');
  } else {
    updateStatus(status);
    if (preload === false) {
      preload = true;
      iceStudio.bus.events.publish('collectionService.getCollections');
    }
    schedulePoll();
  }
}

function collectionsRender(tree) {
  if (tree !== false) {
    let content = iceStudio.gui.el('#cm2-tree', pluginHost);
    collectionsTree = new WafleUITree();
    collectionsTree.setId(pluginUUID);
    collectionsTree.setTree(tree);

    if (content) {
      content.innerHTML = collectionsTree.render();
      collectionsTree.setDomRoot(pluginHost);
      iceStudio.gui.activateEventsFromId(
        `#tree-view-${pluginUUID}`,
        pluginHost,
        mouseEvents
      );
      //-- Note: the status panel is NOT hidden here on purpose. While a
      //-- previous tree is preloaded during indexing, the progress (spinner +
      //-- message + path) must stay visible. It is hidden when indexing ends
      //-- (see collectionsIndexStatus).

      //-- Re-apply the active filter to the freshly rendered tree
      applyTreeFilter(filterQuery);
    }
  }
}

//-- Capture the current fold state, keyed by folder id (data-nodeid) so it
//-- survives a tree re-render. Returns a map id -> isClosed(boolean).
function snapshotFoldState(folders) {
  let state = {};
  folders.forEach(function (f) {
    let id = f.getAttribute('data-nodeid');
    if (id) {
      state[id] = f.classList.contains('closed');
    }
  });
  return state;
}

//-- Real-time block filter. Shows only the leaves (blocks) whose name matches
//-- the query, keeps and unfolds all their parent folders (so the user sees
//-- where each match comes from), and hides folders with no match. When the
//-- query is cleared, the tree is restored to exactly the fold state it had
//-- right before filtering started (captured the first time a filter is typed).
function applyTreeFilter(query) {
  let content = iceStudio.gui.el('#cm2-tree', pluginHost);
  if (!content) {
    return;
  }

  query = (query || '').trim().toLowerCase();

  let leaves = content.querySelectorAll('.tree-view--leaf');
  let folders = content.querySelectorAll('.tree-view--folder');

  //-- Empty query: clear the filter and restore the fold state the tree had
  //-- right before filtering started (default closed view if none was saved).
  if (query === '') {
    leaves.forEach(function (l) {
      l.style.display = '';
    });
    folders.forEach(function (f) {
      f.style.display = '';
      let id = f.getAttribute('data-nodeid');
      let wasClosed =
        savedFoldState &&
        id &&
        Object.prototype.hasOwnProperty.call(savedFoldState, id)
          ? savedFoldState[id]
          : true; //-- unknown folder: default to closed
      if (wasClosed) {
        f.classList.add('closed');
      } else {
        f.classList.remove('closed');
      }
    });
    savedFoldState = null;
    return;
  }

  //-- Entering filter mode: remember the current fold state once, so it can be
  //-- restored verbatim when the filter is later cleared.
  if (!savedFoldState) {
    savedFoldState = snapshotFoldState(folders);
  }

  //-- Show matching leaves and reveal/unfold their ancestor folders
  leaves.forEach(function (l) {
    let name = (l.textContent || '').toLowerCase();
    if (name.indexOf(query) !== -1) {
      l.style.display = 'block';
      let p = l.parentElement;
      while (p && p !== content) {
        if (p.classList && p.classList.contains('tree-view--folder')) {
          p.style.display = '';
          p.classList.remove('closed'); //-- unfold so the match is visible
        }
        p = p.parentElement;
      }
    } else {
      l.style.display = 'none';
    }
  });

  //-- Hide folders that ended up without any visible block
  folders.forEach(function (f) {
    let inner = f.querySelectorAll('.tree-view--leaf');
    let hasVisible = false;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i].style.display !== 'none') {
        hasVisible = true;
        break;
      }
    }
    if (hasVisible) {
      f.style.display = '';
      f.classList.remove('closed');
    } else {
      f.style.display = 'none';
    }
  });
}

function registerEvents() {
  iceStudio.bus.events.subscribe(
    'pluginManager.env',
    setupEnvironment,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'pluginManager.updateEnv',
    setupEnvironment,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'collectionService.indexStatus',
    collectionsIndexStatus,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'collectionService.collections',
    collectionsRender,
    false,
    pluginUUID
  );
}

//-- Header toolbar events (Reindex button)
function headerEvents(eventType, handler, args) {
  if (eventType === 'click' && handler === 'this.reindex') {
    //-- Give immediate feedback while the worker rescans from disk
    preload = false;
    updateStatus(
      { indexing: true, total: 0, done: 0, current: '' },
      'Reindexing…'
    );
    iceStudio.bus.events.publish('collectionService.reindex');
    schedulePoll();
  }
}

function mouseEvents(eventType, handler, args) {
  switch (eventType) {
    case 'click':
      switch (handler) {
        case 'this.toggleFolder':
          collectionsTree.toggle(pluginHost, args.id);
          break;
        case 'this.getBlock':
          collectionsTree.getBlock(pluginHost, args);
          break;
      }
      break;
  }
}
