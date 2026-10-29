import type { Platform } from './release.ts';

export type Lang = 'en' | 'de';

/**
 * Every text of the landing page in one language. Inline marks: `code`, **strong**, [text](url).
 * Placeholders in braces ({version}) are filled in by the page.
 */
export interface Content {
  lang: Lang;
  /** For dates and numbers. */
  locale: string;
  meta: { title: string; description: string };
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
    server: { title: string; text: string };
    /** The link after the answer about servers, to the commands on the download page. */
    commands: string;
  };
  providers: { title: string; lead: string; head: [string, string]; rows: [string, string][]; note: string };
  cli: { title: string; text: string; code: string; exit: string };
  download: {
    /** The download page's title and description for search engines and links. */
    meta: { title: string; description: string };
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
  footer: {
    title: string;
    text: string;
    /** Under the download button of the closing scene; {version} is filled in. */
    download: string;
    /** The invitation to support, with its heading and button, in the closing scene. */
    supportTitle: string;
    support: string;
    supportButton: string;
    supportLink: string;
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
  nav: { skip: 'Skip to content', language: 'Deutsch', download: 'Download' },
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
      'The plan of a migration from kontakt@example.org on imap.example.net to the same address on mail.example.org: a notice that nothing changes in the source, the Sync option, and five folders with their targets and message counts.',
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
    server: {
      title: 'On servers too',
      text: 'The same engine runs on the command line and as a Docker image, for example for a nightly backup on a NAS.',
    },
    commands: 'See the commands',
  },
  providers: {
    title: 'Works with your provider',
    lead: 'Any IMAP server works. For these, the app knows the settings and tells you what to prepare.',
    head: ['Provider', 'How you sign in'],
    rows: [
      ['Gmail', 'An app password. It needs two-step verification.'],
      ['Outlook.com, Hotmail, Microsoft 365', '“Sign in with Microsoft” in the app. Microsoft no longer accepts passwords for IMAP.'],
      ['iCloud, Yahoo', 'An app password from the account settings.'],
      ['GMX, WEB.DE, freenet', 'The normal password, once IMAP access is switched on in the web mail.'],
      ['T-Online', 'The separate email password, not the login password.'],
      ['IONOS, STRATO, mittwald, Posteo, mailbox.org', 'The normal password.'],
      ['Any other provider', 'Server, port and password.'],
    ],
    note: 'Passwords and sign-ins are stored encrypted in your system’s key store: Keychain on macOS, DPAPI on Windows, libsecret or KWallet on Linux.',
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
    meta: {
      title: 'Download: IMAP Transfer',
      description: 'IMAP Transfer for macOS, Windows and Linux, every file with its checksum, plus the command line and Docker.',
    },
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
  footer: {
    title: 'Your mail stays with you.',
    text: 'No telemetry, no account, no cloud. The app only talks to your mail servers, and to GitHub to look for updates.',
    download: 'Version {version} for macOS, Windows and Linux.',
    supportTitle: 'Free, and it stays that way',
    support: 'Did IMAP Transfer save you some work? A coffee supports its development.',
    supportButton: 'Buy me a coffee',
    supportLink: 'Support',
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
  nav: { skip: 'Zum Inhalt', language: 'English', download: 'Herunterladen' },
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
    server: {
      title: 'Auch auf dem Server',
      text: 'Dieselbe Technik läuft auf der Kommandozeile und als Docker-Image, etwa für die nächtliche Sicherung auf dem NAS.',
    },
    commands: 'Befehle ansehen',
  },
  providers: {
    title: 'Klappt mit Ihrem Anbieter',
    lead: 'Jeder IMAP-Server geht. Bei diesen kennt die App die Einstellungen und sagt, was Sie vorbereiten müssen.',
    head: ['Anbieter', 'So melden Sie sich an'],
    rows: [
      ['Gmail', 'Mit einem App-Passwort. Dafür braucht es die Anmeldung in zwei Schritten.'],
      ['Outlook.com, Hotmail, Microsoft 365', 'Mit „Mit Microsoft anmelden“ in der App. Microsoft nimmt für IMAP keine Passwörter mehr an.'],
      ['iCloud, Yahoo', 'Mit einem App-Passwort aus den Kontoeinstellungen.'],
      ['GMX, WEB.DE, freenet', 'Mit dem normalen Passwort, sobald der IMAP-Zugriff im Webmailer eingeschaltet ist.'],
      ['T-Online', 'Mit dem eigenen E-Mail-Passwort, nicht dem Login-Passwort.'],
      ['IONOS, STRATO, mittwald, Posteo, mailbox.org', 'Mit dem normalen Passwort.'],
      ['Jeder andere Anbieter', 'Mit Server, Port und Passwort.'],
    ],
    note: 'Passwörter und Anmeldungen liegen verschlüsselt im Schlüsselbund Ihres Systems: Keychain unter macOS, DPAPI unter Windows, libsecret oder KWallet unter Linux.',
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
    meta: {
      title: 'Herunterladen: IMAP Transfer',
      description: 'IMAP Transfer für macOS, Windows und Linux, jede Datei mit Prüfsumme, dazu die Kommandozeile und Docker.',
    },
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
  footer: {
    title: 'Ihre Mails bleiben bei Ihnen.',
    text: 'Keine Nutzungsstatistik, kein Konto, keine Cloud. Die App spricht nur mit Ihren Mailservern, und mit GitHub, um nach Updates zu sehen.',
    download: 'Version {version} für macOS, Windows und Linux.',
    supportTitle: 'Kostenlos, und das bleibt so',
    support: 'Hat IMAP Transfer Ihnen Arbeit erspart? Mit einem Kaffee unterstützen Sie die Entwicklung.',
    supportButton: 'Einen Kaffee spendieren',
    supportLink: 'Unterstützen',
    source: 'Quellcode auf GitHub',
    license: 'MIT-Lizenz',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    liability: 'Haftung',
  },
};

export const CONTENT: Record<Lang, Content> = { en, de };
