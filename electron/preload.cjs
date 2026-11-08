const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,

  getDataRoot: () => ipcRenderer.invoke('data:getRoot'),
  chooseDataRoot: () => ipcRenderer.invoke('data:chooseRoot'),
  loadAll: () => ipcRenderer.invoke('data:loadAll'),
  loadJobsOnly: () => ipcRenderer.invoke('data:loadJobsOnly'),
  openCustomerWindow: (customerId, projectId, opts) => ipcRenderer.invoke('window:openCustomer', customerId, projectId, opts),
  openMaterialsWindow: (view) => ipcRenderer.invoke('window:openMaterials', view),
  openTimeWindow: (view) => ipcRenderer.invoke('window:openTime', view),
  openManageCustomersWindow: () => ipcRenderer.invoke('window:openManageCustomers'),
  openFilesWindow: (customerId, kind) => ipcRenderer.invoke('window:openFiles', { customerId, kind }),
  openDeficienciesWindow: (customerId) => ipcRenderer.invoke('window:openDeficiencies', customerId),

  saveCustomer: (hub, customer) => ipcRenderer.invoke('data:saveCustomer', { hub, customer }),
  renameCustomerFolder: (hub, oldFolder, newName) => ipcRenderer.invoke('data:renameCustomerFolder', { hub, oldFolder, newName }),
  deleteCustomerFolder: (hub, folder) => ipcRenderer.invoke('data:deleteCustomerFolder', { hub, folder }),

  saveRecord: (hub, customerFolder, record, recordFileName) =>
    ipcRenderer.invoke('data:saveRecord', { hub, customerFolder, record, recordFileName }),
  renameRecordFolder: (hub, customerFolder, oldFolder, newName) =>
    ipcRenderer.invoke('data:renameRecordFolder', { hub, customerFolder, oldFolder, newName }),
  deleteRecordFolder: (hub, customerFolder, folder) =>
    ipcRenderer.invoke('data:deleteRecordFolder', { hub, customerFolder, folder }),
  moveRecordToCustomer: (hub, oldCustomerFolder, newCustomerFolder, folder) =>
    ipcRenderer.invoke('data:moveRecordToCustomer', { hub, oldCustomerFolder, newCustomerFolder, folder }),

  // Another window saved jobs/quotes — returns an unsubscribe function
  onDataChanged: (cb) => {
    const fn = () => cb()
    ipcRenderer.on('data:changed', fn)
    return () => ipcRenderer.removeListener('data:changed', fn)
  },

  saveLocalSnapshot: (json) => ipcRenderer.invoke('localdata:save', json),
  loadLocalSnapshot: () => ipcRenderer.invoke('localdata:load'),
  takeLocalRestoreFlag: () => ipcRenderer.invoke('localdata:takeRestoreFlag'),

  // The big lists, one file each in "App Data" (see src/api/fileStore.js)
  appFileLoadAll: (keys) => ipcRenderer.invoke('appfile:loadAll', keys),
  appFileSave: (key, json) => ipcRenderer.invoke('appfile:save', key, json),
  appFileSaveSync: (key, json) => ipcRenderer.sendSync('appfile:saveSync', key, json),
  onAppFileChanged: (cb) => {
    const fn = (e, key, json) => cb(key, json)
    ipcRenderer.on('appfile:changed', fn)
    return () => ipcRenderer.removeListener('appfile:changed', fn)
  },

  createBackup: () => ipcRenderer.invoke('backup:create'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (name) => ipcRenderer.invoke('backup:restore', name),
  autoBackupIfNeeded: () => ipcRenderer.invoke('backup:autoIfNeeded'),
  onlineBackupRun: () => ipcRenderer.invoke('onlineBackup:run'),
  onlineBackupStatus: () => ipcRenderer.invoke('onlineBackup:status'),
  onlineBackupOpenFolder: () => ipcRenderer.invoke('onlineBackup:openFolder'),

  pdfFromHtml: (html) => ipcRenderer.invoke('pdf:fromHtml', html),
  // opts: { to, cc, subject, text, html, attachments: [paths] } — opens a ready draft with the files attached
  draftEmail: (opts) => ipcRenderer.invoke('email:draft', opts),
  draftEmailMailto: (opts) => ipcRenderer.invoke('email:draftMailto', opts),

  listFiles: (folderPath) => ipcRenderer.invoke('files:list', folderPath),
  addFiles: (folderPath) => ipcRenderer.invoke('files:add', folderPath),
  openFile: (relPath) => ipcRenderer.invoke('files:open', relPath),
  removeFile: (relPath) => ipcRenderer.invoke('files:remove', relPath),
  saveFile: (folderPath, fileName, base64) => ipcRenderer.invoke('files:save', { folderPath, fileName, base64 }),
  readFileBytes: (relPath) => ipcRenderer.invoke('files:readBytes', relPath),

  ordersLoad: () => ipcRenderer.invoke('orders:load'),
  ordersChooseFolder: () => ipcRenderer.invoke('orders:chooseFolder'),
  ordersSaveLocal: (local) => ipcRenderer.invoke('orders:saveLocal', local),
  ordersOpenFolder: () => ipcRenderer.invoke('orders:openFolder'),
  ordersLoadSlipsFeed: () => ipcRenderer.invoke('orders:loadSlipsFeed'),
  ordersReadPoEmails: () => ipcRenderer.invoke('orders:readPoEmails'),
  onedriveInfo: () => ipcRenderer.invoke('onedrive:info'),
  onedriveSetWebBase: (url) => ipcRenderer.invoke('onedrive:setWebBase', url),
  onedrivePublishSlips: (args) => ipcRenderer.invoke('onedrive:publishSlips', args),
  ordersOpenQuoteFile: (number) => ipcRenderer.invoke('orders:openQuoteFile', number),
  ordersOpenQuoteSlips: () => ipcRenderer.invoke('orders:openQuoteSlips'),
  ordersListQuoteSlips: () => ipcRenderer.invoke('orders:listQuoteSlips'),
  ordersReadQuoteSlip: (name) => ipcRenderer.invoke('orders:readQuoteSlip', name),
  ordersCopyQuoteToRecord: (args) => ipcRenderer.invoke('orders:copyQuoteToRecord', args),
  ordersAttachQuoteFile: (number) => ipcRenderer.invoke('orders:attachQuoteFile', number),
  workOrderCopyToRecord: (args) => ipcRenderer.invoke('workOrders:copyToRecord', args),
  workOrderPickToRecord: (args) => ipcRenderer.invoke('workOrders:pickToRecord', args),
  workOrdersOpenFolder: () => ipcRenderer.invoke('workOrders:openFolder'),
  emailNotesLoad: () => ipcRenderer.invoke('emailNotes:load'),
  emailNotesSaveLocal: (local) => ipcRenderer.invoke('emailNotes:saveLocal', local),
  assistantStatus: () => ipcRenderer.invoke('assistant:status'),
  assistantSetToken: (token) => ipcRenderer.invoke('assistant:setToken', token),
  assistantUpdateNow: () => ipcRenderer.invoke('assistant:updateNow'),
  // ask the email run to find one purchase's PDF and save it to Quote Slips / Material Slips
  assistantFindPdf: (req) => ipcRenderer.invoke('assistant:findPdf', req),
  openExternal: (url) => ipcRenderer.invoke('link:openExternal', url),
})
