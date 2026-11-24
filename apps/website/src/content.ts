import type { Platform } from './release.ts';

export type Lang = 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt';

/** The languages of the app, in the order the language menu lists them. English is the root. */
export const LANGS: Lang[] = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt'];

/** The tag for lang="": the Portuguese is that of Portugal, as in the app. */
export const TAG: Record<Lang, string> = { en: 'en', de: 'de', fr: 'fr', es: 'es', it: 'it', nl: 'nl', pt: 'pt-PT' };

/** Each language in its own words, for the language menu. */
export const NAMES: Record<Lang, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
};

/**
 * Every text of the landing page in one language. Inline marks: `code`, **strong**, [text](url).
 * Placeholders in braces ({version}) are filled in by the page.
 */
export interface Content {
  lang: Lang;
  /** For dates and numbers. */
  locale: string;
  meta: { title: string; description: string };
  /** `language` labels the language menu. */
  nav: { skip: string; language: string; download: string };
  preview: string;
  hero: {
    /** The headline as it breaks: two lines on every width. */
    title: [string, string];
    lead: string;
    button: string;
    buttonFor: Record<Platform, string>;
    version: string;
    all: string;
    soon: string;
    image: string;
  };
  backup: { title: string; text: string; facts: string[]; tree: string; caption: string };
  migrate: { title: string; text: string; kept: string; sync: string; image: string };
  /** Short answers to what people ask before they trust a tool with their mail. */
  questions: {
    title: string;
    stop: { title: string; text: string };
    clean: { title: string; text: string };
    providers: { title: string; text: string };
    gmail: { title: string; text: string };
  };
  cli: { title: string; text: string; code: string; exit: string };
  download: {
    title: string;
    released: string;
    /** Per system: its name, and a sentence that helps choose among its installers. */
    systems: Record<Platform, { name: string; hint: string }>;
    /** The label of each installer's button, by slot key (mac-arm64-dmg …). */
    variants: Record<string, string>;
    /** Under a button whose file is not there yet. */
    missing: string;
    yours: string;
    copy: string;
    copied: string;
    checkTitle: string;
    checkText: string;
    choose: string;
    drop: string;
    checking: string;
    match: string;
    mismatch: string;
    unreadable: string;
    terminal: string;
    commands: Record<Platform, string>;
    none: string;
    /** Under the intro: liability is limited, back up first; the link leads to the liability section. */
    liability: string;
    liabilityLink: string;
  };
  /** The page the server answers unknown paths with: one line per language. */
  notFound: { title: string; link: string };
  footer: {
    title: string;
    text: string;
    source: string;
    license: string;
    imprint: string;
    privacy: string;
    liability: string;
  };
}

export const en: Content = {
  lang: 'en',
  locale: 'en-GB',
  meta: {
    title: 'IMAP Transfer: back up, restore and move mail accounts',
    description:
      'Free, open-source app for macOS, Windows and Linux. Backs up mail accounts as .eml files, restores them and moves them from one provider to another.',
  },
  nav: { skip: 'Skip to content', language: 'Language', download: 'Download' },
  preview: 'Preview with example data. The downloads on this page are not real.',
  hero: {
    title: ['Back up and', 'move your mail'],
    lead:
      'Switch providers without losing a single message, or back up your mailbox before you cancel it. Free, for macOS, Windows and Linux.',
    button: 'Download',
    buttonFor: { mac: 'Download for macOS', windows: 'Download for Windows', linux: 'Download for Linux' },
    version: 'Version {version}.',
    all: 'All systems and checksums',
    soon: 'The first version is on its way.',
    image:
      'IMAP Transfer with three accounts in the sidebar. The open account offers back up, restore, migrate and optimize; its migration target is the same address on another server.',
  },
  backup: {
    title: 'One file per message',
    text: 'A backup is an ordinary folder: one `.eml` file per message, sorted like your account. Every mail program opens these files, with or without IMAP Transfer.',
    facts: [
      'After the first run, only new mail is fetched.',
      'Mail you delete in the account stays in the backup.',
      'An mbox export takes everything to Thunderbird or Apple Mail.',
    ],
    tree: [
      'anna@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Invoice May_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Lunch on Friday_8c41d27e90.eml',
      '    ├── Archive/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contract_b7e0a5f312.eml',
      '    └── Sent/',
      '        └── 2024-05-04_Offer for the garden_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'The backup of anna@example.com on disk. The index next to the mail remembers folders, flags and dates.',
  },
  migrate: {
    title: 'From provider to provider',
    text: 'Choose the target account, and IMAP Transfer shows every folder and where it goes: Sent becomes Sent Items, a missing folder is created. Mail that is already there is skipped.',
    kept: 'The old account stays as it is. The migration only reads from it.',
    sync: 'Until you have switched over, **Sync** keeps the new account in step with the old one: what you delete or move there happens here too.',
    image:
      'The plan of a migration from hello@example.org on imap.example.net to the same address on mail.example.org: a notice that nothing changes in the source, the Sync option, and five folders with their targets and message counts.',
  },
  questions: {
    title: 'Before you ask',
    stop: {
      title: 'Stop whenever you like',
      text: 'Close the laptop or lose the connection: the next run continues where the last one ended, without a single duplicate.',
    },
    clean: {
      title: 'Duplicates cleaned up',
      text: 'A test run lists every exact copy and changes nothing. Only then do you decide; one of each message stays.',
    },
    providers: {
      title: 'Any IMAP provider',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo and every other. The app knows their settings and tells you what to prepare.',
    },
    gmail: {
      title: 'Gmail labels kept',
      text: 'A message with five labels is stored once and goes back into all five when you restore it.',
    },
  },
  cli: {
    title: 'On the command line',
    text: 'The same engine runs on servers, NAS boxes and from cron, as `imaptransfer`. It needs Node.js 22.18 or newer, or Docker.',
    code: [
      '# Back up; later runs only fetch what is new',
      'npx imaptransfer backup ~/Backups/anna --user anna@example.com',
      '',
      '# Every night at 2:00 (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/anna --user anna@example.com --password-file /root/.anna-imap --quiet',
      '',
      '# Move an account and keep it in step',
      'imaptransfer migrate --from-user anna@example.com --to-user anna@example.org --sync',
      '',
      '# On a NAS',
      'docker run --rm -v /volume1/backups/anna:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user anna@example.com',
    ].join('\n'),
    exit: 'Exit codes tell a script what happened: `0` done, `2` done but some messages failed, `1` failed, `130` stopped.',
  },
  download: {
    title: 'Download',
    released: 'Version {version}, released on {date}. Checksums: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'A disk image. Apple silicon for Macs with an M chip, Intel for older Macs.' },
      windows: { name: 'Windows', hint: 'An installer. Intel and AMD for most PCs, ARM for laptops with a Snapdragon chip.' },
      linux: { name: 'Linux', hint: 'The AppImage runs almost anywhere, the .deb package on Debian and Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel and AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Not available yet',
    yours: 'Your system',
    copy: 'Copy',
    copied: 'Copied',
    checkTitle: 'Check the file',
    checkText:
      'Drop the downloaded file here, or choose it. Your browser computes the checksum itself and compares it with the checksums above; the file does not leave your computer.',
    choose: 'Choose file',
    drop: 'or drop it here',
    checking: 'Computing the checksum of {name} …',
    match: '{name} is intact: its checksum matches the published one.',
    mismatch: '{name} matches none of the files of version {version}. Download it again from this page.',
    unreadable: 'The browser could not read {name}. Choose it again, or check it in a terminal.',
    terminal: 'Or in a terminal:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'The first version is not out yet. As soon as it is, the buttons below download it, each file with its checksum.',
    liability: 'IMAP Transfer is free, and liability is limited accordingly. Back up your mail before you restore, migrate, sync or clean up.',
    liabilityLink: 'About liability',
  },
  notFound: { title: 'This page does not exist', link: 'Go to the start page' },
  footer: {
    title: 'Your mail stays with you.',
    text: 'No telemetry, no account, no cloud. The app only talks to your mail servers and, if you allow it, to GitHub to look for updates.',
    source: 'Source code on GitHub',
    license: 'MIT license',
    imprint: 'Legal notice',
    privacy: 'Privacy policy',
    liability: 'Liability',
  },
};

export const de: Content = {
  lang: 'de',
  locale: 'de-DE',
  meta: {
    title: 'IMAP Transfer: Mailkonten sichern, wiederherstellen und umziehen',
    description:
      'Kostenlose Open-Source-App für macOS, Windows und Linux. Sichert Mailkonten als .eml-Dateien, spielt sie zurück und zieht sie von einem Anbieter zum anderen um.',
  },
  nav: { skip: 'Zum Inhalt', language: 'Sprache', download: 'Herunterladen' },
  preview: 'Vorschau mit Beispieldaten. Die Downloads auf dieser Seite sind nicht echt.',
  hero: {
    title: ['Mails sichern', 'und umziehen'],
    lead:
      'Wechseln Sie den Anbieter, ohne eine Mail zu verlieren, oder sichern Sie Ihr Postfach vor der Kündigung. Kostenlos, für macOS, Windows und Linux.',
    button: 'Herunterladen',
    buttonFor: { mac: 'Für macOS herunterladen', windows: 'Für Windows herunterladen', linux: 'Für Linux herunterladen' },
    version: 'Version {version}.',
    all: 'Alle Systeme und Prüfsummen',
    soon: 'Die erste Version ist unterwegs.',
    image:
      'IMAP Transfer mit drei Konten in der Seitenleiste. Das geöffnete Konto bietet Sichern, Wiederherstellen, Umziehen und Postfach optimieren; als Zielkonto ist dieselbe Adresse auf einem anderen Server gewählt.',
  },
  backup: {
    title: 'Eine Datei pro Mail',
    text: 'Die Sicherung ist ein gewöhnlicher Ordner: eine `.eml`-Datei pro Mail, sortiert wie in Ihrem Konto. Jedes Mailprogramm öffnet sie, auch ohne IMAP Transfer.',
    facts: [
      'Beim ersten Mal kommt alles, danach nur noch das Neue.',
      'Was Sie im Konto löschen, bleibt in der Sicherung.',
      'Der mbox-Export bringt alles zu Thunderbird oder Apple Mail.',
    ],
    tree: [
      'anna@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Rechnung Mai_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Mittagessen am Freitag_8c41d27e90.eml',
      '    ├── Archiv/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Vertrag_b7e0a5f312.eml',
      '    └── Gesendet/',
      '        └── 2024-05-04_Angebot Garten_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'Die Sicherung von anna@example.com auf der Festplatte. Das Verzeichnis neben den Mails merkt sich Ordner, Markierungen und Datum.',
  },
  migrate: {
    title: 'Von Anbieter zu Anbieter',
    text: 'Sie wählen das Zielkonto, und IMAP Transfer zeigt jeden Ordner und wohin er kommt: Aus „Gesendet“ wird „Gesendete Elemente“, ein fehlender Ordner wird angelegt. Was schon im Ziel liegt, wird übersprungen.',
    kept: 'Das alte Konto bleibt, wie es ist. Der Umzug liest dort nur.',
    sync: 'Bis Sie umgestellt haben, hält **Abgleichen** das neue Konto auf dem Stand des alten: Was Sie dort löschen oder verschieben, geschieht auch hier.',
    image:
      'Der Plan eines Umzugs von kontakt@example.org auf imap.example.net zur selben Adresse auf mail.example.org: der Hinweis, dass in der Quelle nichts verändert wird, die Wahl „Abgleichen“ und fünf Ordner mit Ziel und Anzahl der Mails.',
  },
  questions: {
    title: 'Bevor Sie fragen',
    stop: {
      title: 'Abbrechen, wann Sie wollen',
      text: 'Laptop zu oder Verbindung weg: Der nächste Lauf macht dort weiter, wo der letzte aufgehört hat, ohne eine doppelte Mail.',
    },
    clean: {
      title: 'Doppelte Mails aufgeräumt',
      text: 'Ein Testlauf zeigt jede exakte Kopie und ändert nichts. Erst dann entscheiden Sie; von jeder Mail bleibt eine.',
    },
    providers: {
      title: 'Jeder IMAP-Anbieter',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo und alle anderen. Die App kennt die Einstellungen und sagt, was Sie vorbereiten müssen.',
    },
    gmail: {
      title: 'Gmail-Labels bleiben',
      text: 'Eine Mail mit fünf Labels liegt einmal in der Sicherung und kommt beim Wiederherstellen in alle fünf zurück.',
    },
  },
  cli: {
    title: 'Auf der Kommando\u00adzeile',
    text: 'Dieselbe Technik läuft als `imaptransfer` auf Servern, NAS-Geräten und per cron. Sie braucht Node.js 22.18 oder neuer, oder Docker.',
    code: [
      '# Sichern; spätere Läufe holen nur das Neue',
      'npx imaptransfer backup ~/Backups/anna --user anna@example.com',
      '',
      '# Jede Nacht um 2 Uhr (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/anna --user anna@example.com --password-file /root/.anna-imap --quiet',
      '',
      '# Ein Konto umziehen und im Gleichschritt halten',
      'imaptransfer migrate --from-user anna@example.com --to-user anna@example.org --sync',
      '',
      '# Auf einem NAS',
      'docker run --rm -v /volume1/backups/anna:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user anna@example.com',
    ].join('\n'),
    exit: 'Der Rückgabewert sagt einem Skript, was passiert ist: `0` fertig, `2` fertig, aber einige Mails fehlgeschlagen, `1` fehlgeschlagen, `130` abgebrochen.',
  },
  download: {
    title: 'Herunterladen',
    released: 'Version {version}, erschienen am {date}. Prüfsummen: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Ein Disk-Image. Apple Silicon für Macs mit M-Chip, Intel für ältere Macs.' },
      windows: { name: 'Windows', hint: 'Ein Installer. Intel und AMD für die meisten PCs, ARM für Laptops mit Snapdragon-Chip.' },
      linux: { name: 'Linux', hint: 'Das AppImage läuft fast überall, das .deb-Paket auf Debian und Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple Silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel und AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Noch nicht verfügbar',
    yours: 'Ihr System',
    copy: 'Kopieren',
    copied: 'Kopiert',
    checkTitle: 'Datei prüfen',
    checkText:
      'Ziehen Sie die heruntergeladene Datei hierher oder wählen Sie sie aus. Ihr Browser rechnet die Prüfsumme selbst aus und vergleicht sie mit den Prüfsummen oben; die Datei verlässt Ihren Rechner nicht.',
    choose: 'Datei wählen',
    drop: 'oder hierher ziehen',
    checking: 'Prüfsumme von {name} wird berechnet …',
    match: '{name} ist unverändert: Die Prüfsumme stimmt mit der veröffentlichten überein.',
    mismatch: '{name} passt zu keiner Datei der Version {version}. Laden Sie sie hier noch einmal herunter.',
    unreadable: 'Der Browser konnte {name} nicht lesen. Wählen Sie die Datei noch einmal oder prüfen Sie sie im Terminal.',
    terminal: 'Oder im Terminal:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'Die erste Version ist noch nicht erschienen. Sobald sie da ist, laden die Knöpfe unten sie herunter, jede Datei mit ihrer Prüfsumme.',
    liability: 'IMAP Transfer ist kostenlos, und die Haftung ist entsprechend beschränkt. Sichern Sie Ihre Mails, bevor Sie wiederherstellen, umziehen, abgleichen oder aufräumen.',
    liabilityLink: 'Mehr zur Haftung',
  },
  notFound: { title: 'Diese Seite gibt es nicht', link: 'Zur Startseite' },
  footer: {
    title: 'Ihre Mails bleiben bei Ihnen.',
    text: 'Keine Nutzungsstatistik, kein Konto, keine Cloud. Die App spricht nur mit Ihren Mailservern und, wenn Sie es erlauben, mit GitHub, um nach Updates zu sehen.',
    source: 'Quellcode auf GitHub',
    license: 'MIT-Lizenz',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    liability: 'Haftung',
  },
};

export const fr: Content = {
  lang: 'fr',
  locale: 'fr-FR',
  meta: {
    title: 'IMAP Transfer : sauvegarder, restaurer et migrer vos comptes de messagerie',
    description:
      'Application gratuite et open source pour macOS, Windows et Linux. Elle sauvegarde vos comptes de messagerie en fichiers .eml, les restaure et les migre d’un fournisseur à l’autre.',
  },
  nav: { skip: 'Aller au contenu', language: 'Langue', download: 'Télécharger' },
  preview: 'Aperçu avec des données d’exemple. Les téléchargements de cette page ne sont pas réels.',
  hero: {
    title: ['Sauvegardez et', 'migrez vos e-mails'],
    lead:
      'Changez de fournisseur sans perdre un seul message, ou sauvegardez votre boîte aux lettres avant de la résilier. Gratuit, pour macOS, Windows et Linux.',
    button: 'Télécharger',
    buttonFor: { mac: 'Télécharger pour macOS', windows: 'Télécharger pour Windows', linux: 'Télécharger pour Linux' },
    version: 'Version {version}.',
    all: 'Tous les systèmes et sommes de contrôle',
    soon: 'La première version arrive bientôt.',
    image:
      'IMAP Transfer avec trois comptes dans la barre latérale. Le compte ouvert propose Sauvegarder, Restaurer, Migrer et Optimiser la boîte aux lettres ; comme compte cible, la même adresse sur un autre serveur est choisie.',
  },
  backup: {
    title: 'Un fichier par message',
    text: 'Une sauvegarde est un simple dossier : un fichier `.eml` par message, rangé comme dans votre compte. Tous les logiciels de messagerie ouvrent ces fichiers, avec ou sans IMAP Transfer.',
    facts: [
      'À partir de la deuxième fois, seul le nouveau courrier s’ajoute.',
      'Ce que vous supprimez dans le compte reste dans la sauvegarde.',
      'L’export mbox emmène tout vers Thunderbird ou Apple Mail.',
    ],
    tree: [
      'camille@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Facture mai_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Déjeuner vendredi_8c41d27e90.eml',
      '    ├── Archives/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contrat_b7e0a5f312.eml',
      '    └── Envoyés/',
      '        └── 2024-05-04_Devis pour le jardin_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'La sauvegarde du compte camille@example.com sur le disque. L’index à côté des messages retient les dossiers, les marqueurs et les dates.',
  },
  migrate: {
    title: 'D’un fournisseur à l’autre',
    text: 'Choisissez le compte cible : IMAP Transfer montre chaque dossier et sa destination. « Envoyés » devient « Éléments envoyés », un dossier manquant est créé. Les messages déjà présents sont ignorés.',
    kept: 'L’ancien compte reste tel quel. La migration ne fait qu’y lire.',
    sync: 'Jusqu’à ce que vous ayez basculé, **Synchroniser** garde le nouveau compte à jour : ce que vous supprimez ou déplacez dans l’ancien l’est aussi dans le nouveau.',
    image:
      'Le plan d’une migration de contact@example.org sur imap.example.net vers la même adresse sur mail.example.org : un avis indiquant que rien n’est modifié dans la source, l’option « Synchroniser au lieu de seulement ajouter » et cinq dossiers avec leur cible et leur nombre de messages.',
  },
  questions: {
    title: 'Questions fréquentes',
    stop: {
      title: 'Arrêtez quand vous voulez',
      text: 'Ordinateur refermé ou connexion perdue : la prochaine exécution reprend là où la précédente s’est arrêtée, sans un seul doublon.',
    },
    clean: {
      title: 'Doublons nettoyés',
      text: 'Un essai liste chaque copie exacte et ne modifie rien. Ensuite seulement, vous décidez ; un exemplaire de chaque message reste.',
    },
    providers: {
      title: 'Tous les fournisseurs IMAP',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo et tous les autres. L’application connaît leurs réglages et vous dit quoi préparer.',
    },
    gmail: {
      title: 'Libellés Gmail conservés',
      text: 'Un message avec cinq libellés n’est enregistré qu’une fois et retrouve ses cinq libellés lors de la restauration.',
    },
  },
  cli: {
    title: 'En ligne de commande',
    text: 'Le même moteur tourne sur les serveurs, les NAS et via cron, sous le nom `imaptransfer`. Il faut Node.js 22.18 ou plus récent, ou Docker.',
    code: [
      '# Sauvegarder ; les exécutions suivantes ne récupèrent que le nouveau courrier',
      'npx imaptransfer backup ~/Backups/camille --user camille@example.com',
      '',
      '# Chaque nuit à 2 h (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/camille --user camille@example.com --password-file /root/.camille-imap --quiet',
      '',
      '# Migrer un compte et le garder synchronisé',
      'imaptransfer migrate --from-user camille@example.com --to-user camille@example.org --sync',
      '',
      '# Sur un NAS',
      'docker run --rm -v /volume1/backups/camille:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user camille@example.com',
    ].join('\n'),
    exit: 'Le code de sortie indique au script ce qui s’est passé : `0` terminé, `2` terminé mais certains messages ont échoué, `1` échec, `130` interrompu.',
  },
  download: {
    title: 'Télécharger',
    released: 'Version {version}, publiée le {date}. Sommes de contrôle : SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Une image disque. Puce Apple pour les Mac à puce M, Intel pour les Mac plus anciens.' },
      windows: { name: 'Windows', hint: 'Un programme d’installation. Intel et AMD pour la plupart des PC, ARM pour les portables à puce Snapdragon.' },
      linux: { name: 'Linux', hint: 'L’AppImage fonctionne presque partout, le paquet .deb sur Debian et Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Puce Apple',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel et AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Pas encore disponible',
    yours: 'Votre système',
    copy: 'Copier',
    copied: 'Copié',
    checkTitle: 'Vérifier le fichier',
    checkText:
      'Déposez ici le fichier téléchargé, ou choisissez-le. Votre navigateur calcule lui-même la somme de contrôle et la compare à celles ci-dessus ; le fichier ne quitte pas votre ordinateur.',
    choose: 'Choisir le fichier',
    drop: 'ou déposez-le ici',
    checking: 'Calcul de la somme de contrôle de {name} …',
    match: '{name} est intact : sa somme de contrôle correspond à celle publiée.',
    mismatch: '{name} ne correspond à aucun fichier de la version {version}. Téléchargez-le à nouveau depuis cette page.',
    unreadable: 'Le navigateur n’a pas pu lire {name}. Choisissez-le à nouveau, ou vérifiez-le dans un terminal.',
    terminal: 'Ou dans un terminal :',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'La première version n’est pas encore sortie. Dès sa parution, les boutons ci-dessous la téléchargent, chaque fichier avec sa somme de contrôle.',
    liability: 'IMAP Transfer est gratuit, et la responsabilité est limitée en conséquence. Sauvegardez vos messages avant de restaurer, migrer, synchroniser ou nettoyer.',
    liabilityLink: 'À propos de la responsabilité',
  },
  notFound: { title: 'Cette page n’existe pas', link: 'Aller à la page d’accueil' },
  footer: {
    title: 'Vos messages restent chez vous.',
    text: 'Pas de télémétrie, pas de compte, pas de cloud. L’application ne communique qu’avec vos serveurs de messagerie et, si vous l’autorisez, avec GitHub pour chercher les mises à jour.',
    source: 'Code source sur GitHub',
    license: 'Licence MIT',
    imprint: 'Mentions légales',
    privacy: 'Politique de confidentialité',
    liability: 'Responsabilité',
  },
};

export const es: Content = {
  lang: 'es',
  locale: 'es-ES',
  meta: {
    title: 'IMAP Transfer: copiar, restaurar y migrar cuentas de correo',
    description:
      'Aplicación gratuita y de código abierto para macOS, Windows y Linux. Copia cuentas de correo como archivos .eml, las restaura y las migra de un proveedor a otro.',
  },
  nav: { skip: 'Ir al contenido', language: 'Idioma', download: 'Descargar' },
  preview: 'Vista previa con datos de ejemplo. Las descargas de esta página no son reales.',
  hero: {
    title: ['Copie y migre', 'su correo'],
    lead:
      'Cambie de proveedor sin perder un solo mensaje, o haga una copia de su buzón antes de darlo de baja. Gratis, para macOS, Windows y Linux.',
    button: 'Descargar',
    buttonFor: { mac: 'Descargar para macOS', windows: 'Descargar para Windows', linux: 'Descargar para Linux' },
    version: 'Versión {version}.',
    all: 'Todos los sistemas y sumas de comprobación',
    soon: 'La primera versión está en camino.',
    image:
      'IMAP Transfer con tres cuentas en la barra lateral. La cuenta abierta ofrece Copiar, Restaurar, Migrar y Optimizar el buzón; como cuenta de destino está elegida la misma dirección en otro servidor.',
  },
  backup: {
    title: 'Un archivo por mensaje',
    text: 'La copia de seguridad es una carpeta normal: un archivo `.eml` por mensaje, ordenado como en su cuenta. Cualquier programa de correo abre estos archivos, con o sin IMAP Transfer.',
    facts: [
      'La primera vez se descarga todo; después, solo el correo nuevo.',
      'Lo que borre en la cuenta se queda en la copia.',
      'La exportación a mbox lo lleva todo a Thunderbird o Apple Mail.',
    ],
    tree: [
      'lucia@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Factura mayo_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Comida del viernes_8c41d27e90.eml',
      '    ├── Archivo/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contrato_b7e0a5f312.eml',
      '    └── Enviados/',
      '        └── 2024-05-04_Presupuesto del jardín_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'La copia de seguridad de lucia@example.com en el disco. El índice junto a los mensajes recuerda carpetas, marcas y fechas.',
  },
  migrate: {
    title: 'De un proveedor a otro',
    text: 'Elija la cuenta de destino e IMAP Transfer le muestra cada carpeta y adónde va: «Enviados» pasa a ser «Elementos enviados» y la carpeta que falta se crea. Lo que ya está en el destino se omite.',
    kept: 'La cuenta antigua queda como está. La migración solo lee de ella.',
    sync: 'Hasta que haya hecho el cambio, **Sincronizar** mantiene la cuenta nueva al día con la antigua: lo que borre o mueva allí ocurre también aquí.',
    image:
      'El plan de una migración de contacto@example.org en imap.example.net a la misma dirección en mail.example.org: el aviso de que en el origen no se cambia nada, la opción «Sincronizar en vez de solo añadir» y cinco carpetas con su destino y su número de mensajes.',
  },
  questions: {
    title: 'Antes de que pregunte',
    stop: {
      title: 'Pare cuando quiera',
      text: 'Si cierra el portátil o se corta la conexión, la próxima ejecución sigue donde terminó la anterior, sin un solo duplicado.',
    },
    clean: {
      title: 'Adiós a los duplicados',
      text: 'Una prueba muestra cada copia exacta y no cambia nada. Solo entonces decide usted; de cada mensaje queda uno.',
    },
    providers: {
      title: 'Cualquier proveedor IMAP',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo y todos los demás. La aplicación conoce su configuración y le dice qué debe preparar.',
    },
    gmail: {
      title: 'Las etiquetas de Gmail se conservan',
      text: 'Un mensaje con cinco etiquetas se guarda una sola vez y, al restaurarlo, vuelve a las cinco.',
    },
  },
  cli: {
    title: 'En la línea de comandos',
    text: 'El mismo motor funciona en servidores, en un NAS y desde cron, como `imaptransfer`. Necesita Node.js 22.18 o posterior, o Docker.',
    code: [
      '# Copiar; las siguientes ejecuciones solo descargan lo nuevo',
      'npx imaptransfer backup ~/Backups/lucia --user lucia@example.com',
      '',
      '# Cada noche a las 2:00 (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/lucia --user lucia@example.com --password-file /root/.lucia-imap --quiet',
      '',
      '# Migrar una cuenta y mantenerla sincronizada',
      'imaptransfer migrate --from-user lucia@example.com --to-user lucia@example.org --sync',
      '',
      '# En un NAS',
      'docker run --rm -v /volume1/backups/lucia:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user lucia@example.com',
    ].join('\n'),
    exit: 'El código de salida le dice a un script qué ha pasado: `0` terminado, `2` terminado, pero con mensajes fallidos, `1` fallido, `130` interrumpido.',
  },
  download: {
    title: 'Descargar',
    released: 'Versión {version}, publicada el {date}. Sumas de comprobación: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Una imagen de disco. Apple silicon para Mac con chip M, Intel para Mac más antiguos.' },
      windows: { name: 'Windows', hint: 'Un instalador. Intel y AMD para la mayoría de los PC, ARM para portátiles con chip Snapdragon.' },
      linux: { name: 'Linux', hint: 'La AppImage funciona casi en cualquier parte; el paquete .deb, en Debian y Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel y AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Aún no disponible',
    yours: 'Su sistema',
    copy: 'Copiar',
    copied: 'Copiado',
    checkTitle: 'Comprobar el archivo',
    checkText:
      'Arrastre aquí el archivo descargado o elíjalo. Su navegador calcula él mismo la suma de comprobación y la compara con las de arriba; el archivo no sale de su ordenador.',
    choose: 'Elegir archivo',
    drop: 'o arrástrelo aquí',
    checking: 'Calculando la suma de comprobación de {name}…',
    match: '{name} está intacto: su suma de comprobación coincide con la publicada.',
    mismatch: '{name} no coincide con ningún archivo de la versión {version}. Vuelva a descargarlo desde esta página.',
    unreadable: 'El navegador no ha podido leer {name}. Elíjalo de nuevo o compruébelo en un terminal.',
    terminal: 'O en un terminal:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'La primera versión aún no ha salido. En cuanto salga, los botones de abajo la descargarán, cada archivo con su suma de comprobación.',
    liability: 'IMAP Transfer es gratuito y, en consecuencia, la responsabilidad es limitada. Haga una copia de su correo antes de restaurar, migrar, sincronizar o limpiar.',
    liabilityLink: 'Sobre la responsabilidad',
  },
  notFound: { title: 'Esta página no existe', link: 'Ir a la página de inicio' },
  footer: {
    title: 'Su correo se queda con usted.',
    text: 'Sin telemetría, sin cuenta, sin nube. La aplicación solo habla con sus servidores de correo y, si usted lo permite, con GitHub para buscar actualizaciones.',
    source: 'Código fuente en GitHub',
    license: 'Licencia MIT',
    imprint: 'Aviso legal',
    privacy: 'Política de privacidad',
    liability: 'Responsabilidad',
  },
};

export const it: Content = {
  lang: 'it',
  locale: 'it-IT',
  meta: {
    title: 'IMAP Transfer: backup, ripristino e migrazione di account di posta',
    description:
      'App gratuita e open source per macOS, Windows e Linux. Salva gli account di posta come file .eml, li ripristina e li sposta da un provider all’altro.',
  },
  nav: { skip: 'Vai al contenuto', language: 'Lingua', download: 'Scarica' },
  preview: 'Anteprima con dati di esempio. I download di questa pagina non sono reali.',
  hero: {
    title: ['Salva e sposta', 'la tua posta'],
    lead:
      'Cambia provider senza perdere un solo messaggio, o salva la tua casella prima di disdirla. Gratis, per macOS, Windows e Linux.',
    button: 'Scarica',
    buttonFor: { mac: 'Scarica per macOS', windows: 'Scarica per Windows', linux: 'Scarica per Linux' },
    version: 'Versione {version}.',
    all: 'Tutti i sistemi e i checksum',
    soon: 'La prima versione è in arrivo.',
    image:
      'IMAP Transfer con tre account nella barra laterale. L’account aperto offre Backup, Ripristino, Migrazione e Ottimizza casella; come account di destinazione è scelto lo stesso indirizzo su un altro server.',
  },
  backup: {
    title: 'Un file per messaggio',
    text: 'Un backup è una normale cartella: un file `.eml` per messaggio, ordinati come nel tuo account. Ogni programma di posta li apre, con o senza IMAP Transfer.',
    facts: [
      'Dopo la prima volta si scarica solo la posta nuova.',
      'Ciò che elimini nell’account resta nel backup.',
      'L’esportazione mbox porta tutto in Thunderbird o Apple Mail.',
    ],
    tree: [
      'giulia@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Fattura maggio_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Pranzo di venerdì_8c41d27e90.eml',
      '    ├── Archivio/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contratto_b7e0a5f312.eml',
      '    └── Inviati/',
      '        └── 2024-05-04_Preventivo giardino_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'Il backup di giulia@example.com sul disco. L’indice accanto ai messaggi ricorda cartelle, contrassegni e date.',
  },
  migrate: {
    title: 'Da provider a provider',
    text: 'Scegli l’account di destinazione e IMAP Transfer mostra ogni cartella e dove finisce: “Inviati” diventa “Posta inviata”, una cartella mancante viene creata. I messaggi già presenti vengono saltati.',
    kept: 'Il vecchio account resta com’è. La migrazione lì legge soltanto.',
    sync: 'Finché non hai completato il passaggio, **Sincronizza** tiene il nuovo account allineato al vecchio: ciò che elimini o sposti nel vecchio avviene anche nel nuovo.',
    image:
      'Il piano di una migrazione da info@example.org su imap.example.net allo stesso indirizzo su mail.example.org: l’avviso che nella sorgente non cambia nulla, l’opzione Sincronizza e cinque cartelle con destinazione e numero di messaggi.',
  },
  questions: {
    title: 'Prima che tu lo chieda',
    stop: {
      title: 'Interrompi quando vuoi',
      text: 'Chiudi il portatile o perdi la connessione: la prossima esecuzione riprende da dove si era fermata l’ultima, senza un solo duplicato.',
    },
    clean: {
      title: 'Via i duplicati',
      text: 'Una prova elenca ogni copia esatta e non cambia nulla. Solo dopo decidi tu; di ogni messaggio resta una copia.',
    },
    providers: {
      title: 'Qualsiasi provider IMAP',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo e tutti gli altri. L’app ne conosce le impostazioni e ti dice cosa preparare.',
    },
    gmail: {
      title: 'Etichette Gmail conservate',
      text: 'Un messaggio con cinque etichette viene salvato una volta sola e torna in tutte e cinque quando lo ripristini.',
    },
  },
  cli: {
    title: 'Da riga di comando',
    text: 'Lo stesso motore gira su server, NAS e da cron, come `imaptransfer`. Serve Node.js 22.18 o successivo, oppure Docker.',
    code: [
      '# Backup; le esecuzioni successive scaricano solo il nuovo',
      'npx imaptransfer backup ~/Backups/giulia --user giulia@example.com',
      '',
      '# Ogni notte alle 2:00 (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/giulia --user giulia@example.com --password-file /root/.giulia-imap --quiet',
      '',
      '# Sposta un account e tienilo allineato',
      'imaptransfer migrate --from-user giulia@example.com --to-user giulia@example.org --sync',
      '',
      '# Su un NAS',
      'docker run --rm -v /volume1/backups/giulia:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user giulia@example.com',
    ].join('\n'),
    exit: 'I codici di uscita dicono a uno script cosa è successo: `0` completato, `2` completato ma alcuni messaggi non riusciti, `1` non riuscito, `130` interrotto.',
  },
  download: {
    title: 'Scarica',
    released: 'Versione {version}, pubblicata il {date}. Checksum: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Un’immagine disco. Apple silicon per i Mac con chip M, Intel per i Mac meno recenti.' },
      windows: { name: 'Windows', hint: 'Un programma di installazione. Intel e AMD per la maggior parte dei PC, ARM per i portatili con chip Snapdragon.' },
      linux: { name: 'Linux', hint: 'L’AppImage funziona quasi ovunque, il pacchetto .deb su Debian e Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel e AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Non ancora disponibile',
    yours: 'Il tuo sistema',
    copy: 'Copia',
    copied: 'Copiato',
    checkTitle: 'Verifica il file',
    checkText:
      'Trascina qui il file scaricato, oppure sceglilo. Il browser calcola da sé il checksum e lo confronta con quelli qui sopra; il file non lascia il tuo computer.',
    choose: 'Scegli file',
    drop: 'o trascinalo qui',
    checking: 'Calcolo del checksum di {name} …',
    match: '{name} è integro: il suo checksum corrisponde a quello pubblicato.',
    mismatch: '{name} non corrisponde a nessun file della versione {version}. Scaricalo di nuovo da questa pagina.',
    unreadable: 'Il browser non è riuscito a leggere {name}. Sceglilo di nuovo o verificalo in un terminale.',
    terminal: 'Oppure in un terminale:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'La prima versione non è ancora uscita. Appena sarà disponibile, i pulsanti qui sotto la scaricheranno, ogni file con il suo checksum.',
    liability: 'IMAP Transfer è gratuito, e la responsabilità è limitata di conseguenza. Fai un backup della posta prima di ripristinare, migrare, sincronizzare o pulire.',
    liabilityLink: 'Sulla responsabilità',
  },
  notFound: { title: 'Questa pagina non esiste', link: 'Vai alla pagina iniziale' },
  footer: {
    title: 'La tua posta resta con te.',
    text: 'Niente telemetria, niente account, niente cloud. L’app parla solo con i tuoi server di posta e, se lo permetti, con GitHub per cercare aggiornamenti.',
    source: 'Codice sorgente su GitHub',
    license: 'Licenza MIT',
    imprint: 'Note legali',
    privacy: 'Informativa sulla privacy',
    liability: 'Responsabilità',
  },
};

export const nl: Content = {
  lang: 'nl',
  locale: 'nl-NL',
  meta: {
    title: 'IMAP Transfer: mailaccounts back-uppen, herstellen en verhuizen',
    description:
      'Gratis open-source app voor macOS, Windows en Linux. Maakt back-ups van mailaccounts als .eml-bestanden, zet ze terug en verhuist ze van de ene provider naar de andere.',
  },
  nav: { skip: 'Naar de inhoud', language: 'Taal', download: 'Downloaden' },
  preview: 'Voorbeeld met voorbeeldgegevens. De downloads op deze pagina zijn niet echt.',
  hero: {
    title: ['Mail back-uppen', 'en verhuizen'],
    lead:
      'Stap over naar een andere provider zonder één bericht te verliezen, of maak een back-up van uw postvak voordat u het opzegt. Gratis, voor macOS, Windows en Linux.',
    button: 'Downloaden',
    buttonFor: { mac: 'Downloaden voor macOS', windows: 'Downloaden voor Windows', linux: 'Downloaden voor Linux' },
    version: 'Versie {version}.',
    all: 'Alle systemen en controlesommen',
    soon: 'De eerste versie is onderweg.',
    image:
      'IMAP Transfer met drie accounts in de zijbalk. Het geopende account biedt Back-up, Herstellen, Verhuizen en Postvak optimaliseren; als doelaccount is hetzelfde adres op een andere server gekozen.',
  },
  backup: {
    title: 'Eén bestand per bericht',
    text: 'Een back-up is een gewone map: één `.eml`-bestand per bericht, gesorteerd zoals in uw account. Elk mailprogramma opent deze bestanden, met of zonder IMAP Transfer.',
    facts: [
      'De eerste keer komt alles binnen, daarna alleen nieuwe mail.',
      'Wat u in het account verwijdert, blijft in de back-up.',
      'Met de mbox-export gaat alles naar Thunderbird of Apple Mail.',
    ],
    tree: [
      'sanne@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Factuur mei_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Lunch op vrijdag_8c41d27e90.eml',
      '    ├── Archief/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contract_b7e0a5f312.eml',
      '    └── Verzonden/',
      '        └── 2024-05-04_Offerte tuin_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'De back-up van sanne@example.com op schijf. De index naast de mail onthoudt mappen, markeringen en datums.',
  },
  migrate: {
    title: 'Van provider naar provider',
    text: 'Kies het doelaccount, en IMAP Transfer toont elke map en waar die terechtkomt: Verzonden wordt Verzonden items, een ontbrekende map wordt aangemaakt. Wat al in het doel staat, wordt overgeslagen.',
    kept: 'Het oude account blijft zoals het is. De verhuizing leest daar alleen.',
    sync: 'Tot u bent overgestapt, houdt **Synchroniseren** het nieuwe account gelijk met het oude: wat u daar verwijdert of verplaatst, gebeurt hier ook.',
    image:
      'Het plan van een verhuizing van info@example.org op imap.example.net naar hetzelfde adres op mail.example.org: de melding dat in de bron niets verandert, de optie Synchroniseren en vijf mappen met hun doel en aantal berichten.',
  },
  questions: {
    title: 'Voordat u het vraagt',
    stop: {
      title: 'Stoppen wanneer u wilt',
      text: 'Laptop dicht of verbinding weg: de volgende run gaat verder waar de vorige stopte, zonder één dubbel bericht.',
    },
    clean: {
      title: 'Dubbele berichten opgeschoond',
      text: 'Een proefrun toont elke exacte kopie en verandert niets. Pas daarna beslist u; van elk bericht blijft er één.',
    },
    providers: {
      title: 'Elke IMAP-provider',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo en alle andere. De app kent hun instellingen en vertelt u wat u moet voorbereiden.',
    },
    gmail: {
      title: 'Gmail-labels blijven',
      text: 'Een bericht met vijf labels wordt één keer opgeslagen en komt bij het herstellen terug in alle vijf.',
    },
  },
  cli: {
    title: 'Op de opdrachtregel',
    text: 'Dezelfde techniek draait als `imaptransfer` op servers, NAS-apparaten en via cron. Daarvoor is Node.js 22.18 of nieuwer nodig, of Docker.',
    code: [
      '# Back-up maken; latere runs halen alleen het nieuwe op',
      'npx imaptransfer backup ~/Backups/sanne --user sanne@example.com',
      '',
      '# Elke nacht om 2:00 (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/sanne --user sanne@example.com --password-file /root/.sanne-imap --quiet',
      '',
      '# Een account verhuizen en gelijk houden',
      'imaptransfer migrate --from-user sanne@example.com --to-user sanne@example.org --sync',
      '',
      '# Op een NAS',
      'docker run --rm -v /volume1/backups/sanne:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user sanne@example.com',
    ].join('\n'),
    exit: 'De exitcode vertelt een script wat er gebeurd is: `0` klaar, `2` klaar maar sommige berichten mislukt, `1` mislukt, `130` afgebroken.',
  },
  download: {
    title: 'Downloaden',
    released: 'Versie {version}, verschenen op {date}. Controlesommen: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Een schijfkopie. Apple silicon voor Macs met een M-chip, Intel voor oudere Macs.' },
      windows: { name: 'Windows', hint: 'Een installatieprogramma. Intel en AMD voor de meeste pc’s, ARM voor laptops met een Snapdragon-chip.' },
      linux: { name: 'Linux', hint: 'De AppImage draait bijna overal, het .deb-pakket op Debian en Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel en AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Nog niet beschikbaar',
    yours: 'Uw systeem',
    copy: 'Kopiëren',
    copied: 'Gekopieerd',
    checkTitle: 'Bestand controleren',
    checkText:
      'Sleep het gedownloade bestand hierheen of kies het. Uw browser berekent de controlesom zelf en vergelijkt die met de controlesommen hierboven; het bestand verlaat uw computer niet.',
    choose: 'Bestand kiezen',
    drop: 'of sleep het hierheen',
    checking: 'Controlesom van {name} wordt berekend …',
    match: '{name} is ongewijzigd: de controlesom komt overeen met de gepubliceerde.',
    mismatch: '{name} past bij geen enkel bestand van versie {version}. Download het opnieuw via deze pagina.',
    unreadable: 'De browser kon {name} niet lezen. Kies het opnieuw of controleer het in een terminal.',
    terminal: 'Of in een terminal:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'De eerste versie is nog niet verschenen. Zodra die er is, downloaden de knoppen hieronder haar, elk bestand met zijn controlesom.',
    liability: 'IMAP Transfer is gratis, en de aansprakelijkheid is daarnaar beperkt. Maak een back-up van uw mail voordat u herstelt, verhuist, synchroniseert of opschoont.',
    liabilityLink: 'Meer over aansprakelijkheid',
  },
  notFound: { title: 'Deze pagina bestaat niet', link: 'Naar de startpagina' },
  footer: {
    title: 'Uw mail blijft bij u.',
    text: 'Geen telemetrie, geen account, geen cloud. De app praat alleen met uw mailservers en, als u dat toestaat, met GitHub om naar updates te zoeken.',
    source: 'Broncode op GitHub',
    license: 'MIT-licentie',
    imprint: 'Colofon',
    privacy: 'Privacyverklaring',
    liability: 'Aansprakelijkheid',
  },
};

export const pt: Content = {
  lang: 'pt',
  locale: 'pt-PT',
  meta: {
    title: 'IMAP Transfer: cópias de segurança, restauro e migração de contas de e-mail',
    description:
      'Aplicação gratuita e de código aberto para macOS, Windows e Linux. Faz cópias de segurança de contas de e-mail em ficheiros .eml, restaura-as e migra-as de um fornecedor para outro.',
  },
  nav: { skip: 'Saltar para o conteúdo', language: 'Idioma', download: 'Transferir' },
  preview: 'Pré-visualização com dados de exemplo. As transferências desta página não são reais.',
  hero: {
    title: ['Proteja e migre', 'o seu e-mail'],
    lead:
      'Mude de fornecedor sem perder uma única mensagem, ou faça uma cópia de segurança da sua caixa de correio antes de a cancelar. Gratuito, para macOS, Windows e Linux.',
    button: 'Transferir',
    buttonFor: { mac: 'Transferir para macOS', windows: 'Transferir para Windows', linux: 'Transferir para Linux' },
    version: 'Versão {version}.',
    all: 'Todos os sistemas e somas de verificação',
    soon: 'A primeira versão está a caminho.',
    image:
      'O IMAP Transfer com três contas na barra lateral. A conta aberta oferece Cópia de segurança, Restaurar, Migrar e Otimizar caixa de correio; como conta de destino está escolhido o mesmo endereço noutro servidor.',
  },
  backup: {
    title: 'Um ficheiro por mensagem',
    text: 'Uma cópia de segurança é uma pasta normal: um ficheiro `.eml` por mensagem, organizado como na sua conta. Qualquer programa de e-mail abre estes ficheiros, com ou sem o IMAP Transfer.',
    facts: [
      'Depois da primeira vez, só é acrescentado o que é novo.',
      'O que apagar na conta continua na cópia de segurança.',
      'A exportação mbox leva tudo para o Thunderbird ou o Apple Mail.',
    ],
    tree: [
      'joana@example.com/',
      '├── README.txt',
      '├── imaptransfer.db',
      '└── mail/',
      '    ├── INBOX/',
      '    │   ├── 2024-05-03_Fatura maio_3f2a9c01b4.eml',
      '    │   └── 2024-05-06_Almoço na sexta_8c41d27e90.eml',
      '    ├── Arquivo/',
      '    │   └── 2023/',
      '    │       └── 2023-11-20_Contrato_b7e0a5f312.eml',
      '    └── Enviados/',
      '        └── 2024-05-04_Orçamento jardim_51d9c0e6a8.eml',
    ].join('\n'),
    caption: 'A cópia de segurança de joana@example.com no disco. O índice ao lado das mensagens guarda pastas, marcas e datas.',
  },
  migrate: {
    title: 'De fornecedor para fornecedor',
    text: 'Escolha a conta de destino, e o IMAP Transfer mostra cada pasta e para onde vai: «Enviados» passa a «Itens Enviados», uma pasta em falta é criada. O que já está no destino é ignorado.',
    kept: 'A conta antiga fica como está. A migração apenas lê de lá.',
    sync: 'Até concluir a mudança, **Sincronizar** mantém a conta nova a par da antiga: o que apagar ou mover lá acontece também aqui.',
    image:
      'O plano de uma migração de geral@example.org em imap.example.net para o mesmo endereço em mail.example.org: o aviso de que nada é alterado na origem, a opção «Sincronizar em vez de apenas acrescentar» e cinco pastas com destino e número de mensagens.',
  },
  questions: {
    title: 'Antes que pergunte',
    stop: {
      title: 'Interrompa quando quiser',
      text: 'Fechou o portátil ou perdeu a ligação? A próxima execução continua onde a última parou, sem uma única mensagem duplicada.',
    },
    clean: {
      title: 'Duplicados limpos',
      text: 'Um teste mostra cada cópia exata e não altera nada. Só depois decide; de cada mensagem fica uma.',
    },
    providers: {
      title: 'Qualquer fornecedor IMAP',
      text: 'Gmail, Outlook, iCloud, GMX, WEB.DE, T-Online, IONOS, Posteo e todos os outros. A aplicação conhece as definições e diz-lhe o que preparar.',
    },
    gmail: {
      title: 'Etiquetas do Gmail mantidas',
      text: 'Uma mensagem com cinco etiquetas é guardada uma única vez e volta para as cinco quando a restaura.',
    },
  },
  cli: {
    title: 'Na linha de comandos',
    text: 'O mesmo motor corre em servidores, em NAS e via cron, como `imaptransfer`. Precisa do Node.js 22.18 ou mais recente, ou do Docker.',
    code: [
      '# Cópia de segurança; as execuções seguintes só trazem o que é novo',
      'npx imaptransfer backup ~/Backups/joana --user joana@example.com',
      '',
      '# Todas as noites às 2:00 (crontab -e)',
      '0 2 * * * imaptransfer backup /srv/backups/joana --user joana@example.com --password-file /root/.joana-imap --quiet',
      '',
      '# Migrar uma conta e mantê-la sincronizada',
      'imaptransfer migrate --from-user joana@example.com --to-user joana@example.org --sync',
      '',
      '# Num NAS',
      'docker run --rm -v /volume1/backups/joana:/backup -e IMAPTRANSFER_PASSWORD \\',
      '  ghcr.io/scherhans/imaptransfer backup /backup --user joana@example.com',
    ].join('\n'),
    exit: 'Os códigos de saída dizem a um script o que aconteceu: `0` concluído, `2` concluído, mas algumas mensagens falharam, `1` falhou, `130` interrompido.',
  },
  download: {
    title: 'Transferir',
    released: 'Versão {version}, publicada a {date}. Somas de verificação: SHA-256.',
    systems: {
      mac: { name: 'macOS', hint: 'Uma imagem de disco. Apple silicon para Macs com chip M, Intel para Macs mais antigos.' },
      windows: { name: 'Windows', hint: 'Um instalador. Intel e AMD para a maioria dos PCs, ARM para portáteis com chip Snapdragon.' },
      linux: { name: 'Linux', hint: 'O AppImage corre em quase todo o lado, o pacote .deb em Debian e Ubuntu.' },
    },
    variants: {
      'mac-arm64-dmg': 'Apple silicon',
      'mac-x64-dmg': 'Intel',
      'windows-x64-exe': 'Intel e AMD',
      'windows-arm64-exe': 'ARM',
      'linux-x64-AppImage': 'AppImage, x64',
      'linux-x64-deb': '.deb, x64',
      'linux-arm64-AppImage': 'AppImage, ARM64',
      'linux-arm64-deb': '.deb, ARM64',
    },
    missing: 'Ainda não disponível',
    yours: 'O seu sistema',
    copy: 'Copiar',
    copied: 'Copiado',
    checkTitle: 'Verificar o ficheiro',
    checkText:
      'Arraste para aqui o ficheiro transferido ou escolha-o. O seu browser calcula a soma de verificação e compara-a com as somas acima; o ficheiro não sai do seu computador.',
    choose: 'Escolher ficheiro',
    drop: 'ou arraste-o para aqui',
    checking: 'A calcular a soma de verificação de {name} …',
    match: '{name} está intacto: a soma de verificação coincide com a publicada.',
    mismatch: '{name} não corresponde a nenhum ficheiro da versão {version}. Transfira-o novamente a partir desta página.',
    unreadable: 'O browser não conseguiu ler {name}. Escolha-o novamente ou verifique-o num terminal.',
    terminal: 'Ou num terminal:',
    commands: { mac: 'macOS', windows: 'Windows (PowerShell)', linux: 'Linux' },
    none: 'A primeira versão ainda não saiu. Assim que sair, os botões abaixo transferem-na, cada ficheiro com a sua soma de verificação.',
    liability: 'O IMAP Transfer é gratuito, e a responsabilidade é limitada em conformidade. Faça uma cópia de segurança do seu e-mail antes de restaurar, migrar, sincronizar ou limpar.',
    liabilityLink: 'Sobre a responsabilidade',
  },
  notFound: { title: 'Esta página não existe', link: 'Ir para a página inicial' },
  footer: {
    title: 'Os seus e-mails ficam consigo.',
    text: 'Sem telemetria, sem conta, sem nuvem. A aplicação só comunica com os seus servidores de e-mail e, se o permitir, com o GitHub para procurar atualizações.',
    source: 'Código-fonte no GitHub',
    license: 'Licença MIT',
    imprint: 'Informação legal',
    privacy: 'Política de privacidade',
    liability: 'Responsabilidade',
  },
};

export const CONTENT: Record<Lang, Content> = { en, de, fr, es, it, nl, pt };
