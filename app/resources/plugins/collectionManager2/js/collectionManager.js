//-- GLOBAL Variables
let collectionsTree = false;

//-- Connect the events in js/ejents.js to the system bus and listen for hooks
registerEvents();

//-- Bind the toolbar (Reindex button) events in the plugin header
iceStudio.gui.activateEventsFromId('#cm2-header', pluginHost, headerEvents);

//-- Bind the real-time block filter input
let cm2FilterInput = iceStudio.gui.el('#cm2-filter', pluginHost);
if (cm2FilterInput) {
  cm2FilterInput.addEventListener('input', function () {
    filterQuery = this.value;
    applyTreeFilter(filterQuery);
  });
}

//Getting environment config, event that start everything inside the plugin
iceStudio.bus.events.publish('pluginManager.getEnvironment');
