import { app } from 'electron';
import type { JobState } from '../shared/api';
import { pickLanguage, type Language, type LanguageChoice } from '../shared/languages';

interface MenuTexts {
  about: string;
  hide: string;
  hideOthers: string;
  showAll: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  window: string;
  minimize: string;
  close: string;
}

interface Texts {
  stopQuestion: string;
  stopDetail: string;
  keepRunning: string;
  stopAndQuit: string;
  jobs: Record<JobState['request']['kind'], string>;
  /** A restore or migration that also takes out what left the source. */
  sync: string;
  outcome: Record<Exclude<JobState['status'], 'running'>, string>;
  updateDownloaded: (version: string) => string;
  /** The page the browser shows after the Microsoft sign-in. */
  signedIn: { title: string; text: string };
  signInFailed: { title: string; text: string };
  menu: MenuTexts;
}

const MENUS: Record<Language, MenuTexts> = {
  de: {
    about: 'Über IMAP Transfer',
    hide: 'IMAP Transfer ausblenden',
    hideOthers: 'Andere ausblenden',
    showAll: 'Alle einblenden',
    quit: 'IMAP Transfer beenden',
    edit: 'Bearbeiten',
    undo: 'Widerrufen',
    redo: 'Wiederholen',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einsetzen',
    selectAll: 'Alles auswählen',
    window: 'Fenster',
    minimize: 'Im Dock ablegen',
    close: 'Schließen',
  },
  en: {
    about: 'About IMAP Transfer',
    hide: 'Hide IMAP Transfer',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit IMAP Transfer',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close',
  },
  fr: {
    about: 'À propos d’IMAP Transfer',
    hide: 'Masquer IMAP Transfer',
    hideOthers: 'Masquer les autres',
    showAll: 'Tout afficher',
    quit: 'Quitter IMAP Transfer',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Tout sélectionner',
    window: 'Fenêtre',
    minimize: 'Placer dans le Dock',
    close: 'Fermer',
  },
  es: {
    about: 'Acerca de IMAP Transfer',
    hide: 'Ocultar IMAP Transfer',
    hideOthers: 'Ocultar otros',
    showAll: 'Mostrar todo',
    quit: 'Salir de IMAP Transfer',
    edit: 'Edición',
    undo: 'Deshacer',
    redo: 'Rehacer',
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar',
    selectAll: 'Seleccionar todo',
    window: 'Ventana',
    minimize: 'Minimizar',
    close: 'Cerrar',
  },
  it: {
    about: 'Informazioni su IMAP Transfer',
    hide: 'Nascondi IMAP Transfer',
    hideOthers: 'Nascondi altre',
    showAll: 'Mostra tutte',
    quit: 'Esci da IMAP Transfer',
    edit: 'Modifica',
    undo: 'Annulla',
    redo: 'Ripeti',
    cut: 'Taglia',
    copy: 'Copia',
    paste: 'Incolla',
    selectAll: 'Seleziona tutto',
    window: 'Finestra',
    minimize: 'Contrai',
    close: 'Chiudi',
  },
  nl: {
    about: 'Over IMAP Transfer',
    hide: 'Verberg IMAP Transfer',
    hideOthers: 'Verberg andere',
    showAll: 'Toon alles',
    quit: 'Stop IMAP Transfer',
    edit: 'Wijzig',
    undo: 'Herstel',
    redo: 'Opnieuw',
    cut: 'Knip',
    copy: 'Kopieer',
    paste: 'Plak',
    selectAll: 'Selecteer alles',
    window: 'Venster',
    minimize: 'Minimaliseer',
    close: 'Sluit',
  },
  'pt-BR': {
    about: 'Sobre o IMAP Transfer',
    hide: 'Ocultar IMAP Transfer',
    hideOthers: 'Ocultar outros',
    showAll: 'Mostrar tudo',
    quit: 'Encerrar IMAP Transfer',
    edit: 'Editar',
    undo: 'Desfazer',
    redo: 'Refazer',
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar',
    selectAll: 'Selecionar tudo',
    window: 'Janela',
    minimize: 'Minimizar',
    close: 'Fechar',
  },
};

/** The few things the main process says itself: dialogs, notifications and the menu. */
const TEXTS: Record<Language, Texts> = {
  de: {
    stopQuestion: 'Es läuft noch ein Vorgang.',
    stopDetail: 'Wenn Sie jetzt beenden, wird er abgebrochen. Beim nächsten Start macht er dort weiter, wo er aufgehört hat.',
    keepRunning: 'Weiterlaufen lassen',
    stopAndQuit: 'Abbrechen und beenden',
    jobs: { backup: 'Sicherung', restore: 'Wiederherstellung', migrate: 'Umzug', dedupe: 'Aufräumen', verify: 'Prüfung', 'export-mbox': 'Export' },
    sync: 'Abgleich',
    outcome: { completed: 'abgeschlossen', cancelled: 'abgebrochen', failed: 'fehlgeschlagen' },
    updateDownloaded: (version) => `Version ${version} ist geladen und wird beim nächsten Start installiert.`,
    signedIn: { title: 'Angemeldet', text: 'Sie können dieses Fenster schließen und zu IMAP Transfer zurückkehren.' },
    signInFailed: { title: 'Anmeldung fehlgeschlagen', text: 'Bitte versuchen Sie es in IMAP Transfer noch einmal.' },
    menu: MENUS.de,
  },
  en: {
    stopQuestion: 'A job is still running.',
    stopDetail: 'Quitting stops it. The next run continues where it stopped.',
    keepRunning: 'Keep running',
    stopAndQuit: 'Stop and quit',
    jobs: { backup: 'Backup', restore: 'Restore', migrate: 'Migration', dedupe: 'Cleanup', verify: 'Check', 'export-mbox': 'Export' },
    sync: 'Sync',
    outcome: { completed: 'completed', cancelled: 'stopped', failed: 'failed' },
    updateDownloaded: (version) => `Version ${version} is downloaded and will be installed on the next start.`,
    signedIn: { title: 'Signed in', text: 'You can close this window and return to IMAP Transfer.' },
    signInFailed: { title: 'Sign-in failed', text: 'Please try again in IMAP Transfer.' },
    menu: MENUS.en,
  },
  fr: {
    stopQuestion: 'Une opération est encore en cours.',
    stopDetail: 'Quitter maintenant l’interrompt. La prochaine exécution reprendra là où elle s’est arrêtée.',
    keepRunning: 'Laisser tourner',
    stopAndQuit: 'Interrompre et quitter',
    jobs: { backup: 'Sauvegarde', restore: 'Restauration', migrate: 'Migration', dedupe: 'Nettoyage', verify: 'Vérification', 'export-mbox': 'Export' },
    sync: 'Synchronisation',
    outcome: { completed: 'terminée', cancelled: 'interrompue', failed: 'échouée' },
    updateDownloaded: (version) => `La version ${version} est téléchargée et sera installée au prochain démarrage.`,
    signedIn: { title: 'Connecté', text: 'Vous pouvez fermer cette fenêtre et revenir à IMAP Transfer.' },
    signInFailed: { title: 'Échec de la connexion', text: 'Veuillez réessayer dans IMAP Transfer.' },
    menu: MENUS.fr,
  },
  es: {
    stopQuestion: 'Todavía hay una operación en curso.',
    stopDetail: 'Si sale ahora, se interrumpirá. La próxima ejecución continuará donde se detuvo.',
    keepRunning: 'Dejar en ejecución',
    stopAndQuit: 'Interrumpir y salir',
    jobs: { backup: 'Copia de seguridad', restore: 'Restauración', migrate: 'Migración', dedupe: 'Limpieza', verify: 'Comprobación', 'export-mbox': 'Exportación' },
    sync: 'Sincronización',
    outcome: { completed: 'completada', cancelled: 'interrumpida', failed: 'fallida' },
    updateDownloaded: (version) => `La versión ${version} se ha descargado y se instalará en el próximo inicio.`,
    signedIn: { title: 'Sesión iniciada', text: 'Puede cerrar esta ventana y volver a IMAP Transfer.' },
    signInFailed: { title: 'No se pudo iniciar sesión', text: 'Inténtelo de nuevo en IMAP Transfer.' },
    menu: MENUS.es,
  },
  it: {
    stopQuestion: 'Un’operazione è ancora in corso.',
    stopDetail: 'Uscendo ora verrà interrotta. La prossima esecuzione riprenderà da dove si è fermata.',
    keepRunning: 'Lascia in esecuzione',
    stopAndQuit: 'Interrompi ed esci',
    jobs: { backup: 'Backup', restore: 'Ripristino', migrate: 'Migrazione', dedupe: 'Pulizia', verify: 'Verifica', 'export-mbox': 'Esportazione' },
    sync: 'Sincronizzazione',
    outcome: { completed: 'completato', cancelled: 'interrotto', failed: 'non riuscito' },
    updateDownloaded: (version) => `La versione ${version} è stata scaricata e verrà installata al prossimo avvio.`,
    signedIn: { title: 'Accesso eseguito', text: 'Puoi chiudere questa finestra e tornare a IMAP Transfer.' },
    signInFailed: { title: 'Accesso non riuscito', text: 'Riprova in IMAP Transfer.' },
    menu: MENUS.it,
  },
  nl: {
    stopQuestion: 'Er loopt nog een bewerking.',
    stopDetail: 'Als u nu afsluit, wordt die afgebroken. De volgende keer gaat het verder waar het gestopt is.',
    keepRunning: 'Laten doorlopen',
    stopAndQuit: 'Afbreken en afsluiten',
    jobs: { backup: 'Back-up', restore: 'Herstel', migrate: 'Verhuizing', dedupe: 'Opschonen', verify: 'Controle', 'export-mbox': 'Export' },
    sync: 'Synchronisatie',
    outcome: { completed: 'voltooid', cancelled: 'afgebroken', failed: 'mislukt' },
    updateDownloaded: (version) => `Versie ${version} is gedownload en wordt bij de volgende start geïnstalleerd.`,
    signedIn: { title: 'Aangemeld', text: 'U kunt dit venster sluiten en teruggaan naar IMAP Transfer.' },
    signInFailed: { title: 'Aanmelden mislukt', text: 'Probeer het opnieuw in IMAP Transfer.' },
    menu: MENUS.nl,
  },
  'pt-BR': {
    stopQuestion: 'Ainda há uma operação em andamento.',
    stopDetail: 'Se sair agora, ela será interrompida. A próxima execução continua de onde parou.',
    keepRunning: 'Deixar em execução',
    stopAndQuit: 'Interromper e sair',
    jobs: { backup: 'Backup', restore: 'Restauração', migrate: 'Migração', dedupe: 'Limpeza', verify: 'Verificação', 'export-mbox': 'Exportação' },
    sync: 'Sincronização',
    outcome: { completed: 'concluído', cancelled: 'interrompido', failed: 'falhou' },
    updateDownloaded: (version) => `A versão ${version} foi baixada e será instalada na próxima inicialização.`,
    signedIn: { title: 'Conectado', text: 'Você pode fechar esta janela e voltar ao IMAP Transfer.' },
    signInFailed: { title: 'Falha no login', text: 'Tente novamente no IMAP Transfer.' },
    menu: MENUS['pt-BR'],
  },
};

let chosen: LanguageChoice = 'system';

/** Takes over the language picked in the window; `system` follows the operating system. */
export function setLanguage(choice: LanguageChoice): void {
  chosen = choice;
}

function mainLanguage(): Language {
  return chosen === 'system' ? pickLanguage(app.getLocale()) : chosen;
}

export function texts(): Texts {
  return TEXTS[mainLanguage()];
}
