/** Nombres de canales IPC. Un único lugar para evitar strings sueltos. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseLibrary: 'settings:choose-library',
  settingsUseDefaultLibrary: 'settings:use-default-library',
  settingsSetHolyricsToken: 'settings:set-holyrics-token',

  libraryScan: 'library:scan',
  libraryGet: 'library:get',
  libraryCreate: 'library:create',
  libraryUpdate: 'library:update',
  libraryDelete: 'library:delete',
  libraryOpenFolder: 'library:open-folder',
  libraryReadTrack: 'library:read-track',
  libraryAddTracks: 'library:add-tracks',
  libraryReplaceTrack: 'library:replace-track',
  libraryRemoveTrack: 'library:remove-track',
  librarySetDurations: 'library:set-durations',

  importChooseZip: 'import:choose-zip',
  importInspectPath: 'import:inspect-path',
  importCommit: 'import:commit',
  importCancel: 'import:cancel',

  holyricsStatus: 'holyrics:status',
  holyricsSearch: 'holyrics:search',
  holyricsSlides: 'holyrics:slides',
  holyricsShow: 'holyrics:show',
  holyricsGoToSlide: 'holyrics:go-to-slide',
  holyricsGoToSection: 'holyrics:go-to-section',
  holyricsClose: 'holyrics:close'
} as const
