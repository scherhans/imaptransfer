import { githubUrl, SITE } from './config.ts';
import type { Lang } from './content.ts';

// Legal notice and privacy policy. The operator's details and the paragraphs on hosting, email and
// rights follow those of textcolumn.com, the operator's other site; the parts on downloads, the
// checksum checker, the app and its building blocks are this site's own. Inline marks as in
// content.ts; a link to a path of this site ("/assets/…") becomes relative on each page.

export type LegalKind = 'imprint' | 'privacy';

export interface LegalSection {
  heading?: string;
  paragraphs: string[];
}

export interface LegalDoc {
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
}

const ADDRESS = 'Sebastian Scherhans\nNiederbrodhagen 11\n33613 Bielefeld';
const EMAIL = `[${SITE.email}](mailto:${SITE.email})`;
const PHONE = '[+49 (0)521-98918703](tel:+4952198918703)';
const VAT = 'DE343507170';
const GITHUB_PRIVACY = 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement';
const MICROSOFT_PRIVACY = 'https://privacy.microsoft.com/privacystatement';
const GITHUB_ADDRESS = 'GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA';
const HOSTER = 'Mittwald CM Service GmbH & Co. KG, Königsberger Straße 4-6, 32339 Espelkamp';
const LICENSE = githubUrl('/blob/main/LICENSE');
const FONT_LICENSES = { newsreader: '/assets/fonts/newsreader-OFL.txt', hanken: '/assets/fonts/hanken-grotesk-OFL.txt' };
const TRADEMARKS =
  'Gmail, Outlook, Hotmail, Microsoft 365, iCloud, Yahoo, GMX, WEB.DE, freenet, T-Online, IONOS, STRATO, mittwald, Posteo, mailbox.org, macOS and Windows';

export const LEGAL: Record<Lang, Record<LegalKind, LegalDoc>> = {
  de: {
    imprint: {
      title: 'Impressum',
      description: 'Anbieterkennzeichnung der Website von IMAP Transfer.',
      updated: 'Stand: Oktober 2026',
      sections: [
        { heading: 'Angaben gemäß § 5 DDG', paragraphs: [ADDRESS] },
        { heading: 'Kontakt', paragraphs: [`Telefon: ${PHONE}\nE-Mail: ${EMAIL}`] },
        { heading: 'Umsatzsteuer-Identifikationsnummer', paragraphs: [`gemäß § 27 a Umsatzsteuergesetz: ${VAT}`] },
        {
          heading: 'Marken',
          paragraphs: [
            `${TRADEMARKS.replace(/, macOS and Windows$/, ', macOS und Windows')} sind Marken ihrer jeweiligen Inhaber. IMAP Transfer ist ein unabhängiges Projekt und steht in keiner Verbindung zu ihnen.`,
          ],
        },
        {
          heading: 'Lizenzen',
          paragraphs: [
            `IMAP Transfer ist freie Software unter der [MIT-Lizenz](${LICENSE}). Die App baut auf freier Software anderer auf. Die wichtigsten Bausteine:`,
            [
              '**ImapFlow** spricht mit den Mailservern: © Postal Systems OÜ, MIT-Lizenz.',
              '**libmime** und **mailsplit** lesen die Mails: © Andris Reinman und Zone Media OÜ, MIT-Lizenz.',
              '**Electron** mit **Chromium** trägt die Desktop-App: © GitHub Inc. und die Electron-Beitragenden, MIT-Lizenz; Chromium unter der BSD-Lizenz und weiteren freien Lizenzen.',
              '**Vue.js** und **Vue I18n** bauen die Oberfläche: © Evan You und kazuya kawaguchi, MIT-Lizenz.',
              '**electron-updater** holt neue Versionen: © Loopline Systems, MIT-Lizenz.',
              '**Commander** liest die Befehle der Kommandozeile: © TJ Holowaychuk, MIT-Lizenz.',
            ].join('\n'),
            'Jede Installation enthält die vollständige Liste aller Bausteine mit ihren Lizenztexten, im Ordner „licenses“ unter den Ressourcen der App. Die Kommandozeile bringt die Lizenztexte mit ihren Paketen mit.',
            `Diese Website nutzt die Schriften Newsreader (© The Newsreader Project Authors) und Hanken Grotesk (© The Hanken Grotesk Project Authors) unter der SIL Open Font License 1.1. Die Lizenztexte liegen bei den Schriftdateien: [Newsreader](${FONT_LICENSES.newsreader}), [Hanken Grotesk](${FONT_LICENSES.hanken}).`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Datenschutzerklärung',
      description: 'Wie die Website und die App IMAP Transfer mit Daten umgehen.',
      updated: 'Stand: Oktober 2026',
      sections: [
        {
          paragraphs: [
            'Kurz gesagt: Diese Website setzt keine Cookies, zählt keine Besucher und lädt nichts von anderen Anbietern. Die App IMAP Transfer läuft auf Ihrem Computer; Ihre Mails und Zugangsdaten bleiben dort, und wir erhalten von ihr keine Daten.',
          ],
        },
        { heading: 'Verantwortlicher', paragraphs: [`${ADDRESS}\n${EMAIL}`] },
        {
          heading: 'Aufruf der Website',
          paragraphs: [
            'Beim Aufruf der Website überträgt Ihr Browser technisch notwendige Angaben an den Server unseres Hosting-Anbieters: IP-Adresse, Datum und Uhrzeit, die abgerufene Datei sowie Angaben zu Browser und Betriebssystem. Sie werden nur verarbeitet, um die Website auszuliefern und ihre Sicherheit zu gewährleisten, und nur so lange gespeichert, wie es dafür nötig ist. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).',
            `Unser Hosting-Anbieter ist die ${HOSTER}. Mit ihr besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.`,
            'Alle Dateien der Website, auch die Schriften, kommen von diesem Server. Es werden keine Inhalte von anderen Anbietern nachgeladen, und es werden keine Cookies gesetzt.',
          ],
        },
        {
          heading: 'Herunterladen',
          paragraphs: [
            'Die Installationsdateien liegen auf demselben Server wie diese Website. Beim Herunterladen überträgt Ihr Browser dieselben Angaben wie beim Aufruf einer Seite, und es gilt das oben Gesagte. Andere Anbieter sind daran nicht beteiligt.',
          ],
        },
        {
          heading: 'Datei prüfen',
          paragraphs: [
            'Wenn Sie eine heruntergeladene Datei auf die Prüffläche ziehen oder auswählen, berechnet Ihr Browser ihre Prüfsumme auf Ihrem Gerät. Die Datei wird dabei nicht übertragen, weder an uns noch an andere.',
          ],
        },
        {
          heading: 'Die App IMAP Transfer',
          paragraphs: [
            'IMAP Transfer läuft auf Ihrem Computer. Mails, Sicherungen, Zugangsdaten und Einstellungen bleiben dort; Passwörter und Anmeldungen liegen verschlüsselt im Schlüsselbund Ihres Systems. Die App verbindet sich mit den Mailservern, die Sie eintragen.',
            `Wählen Sie „Mit Microsoft anmelden“, öffnet die App die Anmeldeseite von Microsoft in Ihrem Browser. Dort gilt die [Datenschutzerklärung von Microsoft](${MICROSOFT_PRIVACY}).`,
            `Beim Start fragt die App bei GitHub (${GITHUB_ADDRESS}) nach, ob es eine neuere Version gibt, und lädt sie gegebenenfalls herunter. GitHub erhält dabei Ihre IP-Adresse und die technischen Angaben der Anfrage und verarbeitet sie nach seiner eigenen [Datenschutzerklärung](${GITHUB_PRIVACY}). Rechtsgrundlage ist unser berechtigtes Interesse, Ihnen Fehlerbehebungen und Sicherheitsupdates bereitzustellen (Art. 6 Abs. 1 lit. f DSGVO).`,
            'Darüber hinaus sendet die App nichts: keine Nutzungsstatistik, keine Absturzberichte, kein Konto. Wir erhalten von der App keine Daten.',
          ],
        },
        {
          heading: 'Kontakt per E-Mail',
          paragraphs: [
            'Wenn Sie uns eine E-Mail schreiben, verarbeiten wir Ihre Adresse und Ihre Nachricht, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist unser berechtigtes Interesse an der Antwort (Art. 6 Abs. 1 lit. f DSGVO). Wir löschen die Daten, sobald Ihre Anfrage erledigt ist und keine gesetzlichen Aufbewahrungspflichten bestehen.',
          ],
        },
        {
          heading: 'Ihre Rechte',
          paragraphs: [
            'Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung Ihrer Daten sowie auf Datenübertragbarkeit (Art. 15 bis 20 DSGVO). Wenden Sie sich dafür an die oben genannte E-Mail-Adresse. Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen.',
          ],
        },
        {
          heading: 'Widerspruchsrecht',
          paragraphs: [
            'Verarbeiten wir Ihre Daten auf Grundlage unseres berechtigten Interesses (Art. 6 Abs. 1 lit. f DSGVO), können Sie dem jederzeit widersprechen, wenn sich dafür Gründe aus Ihrer besonderen Situation ergeben (Art. 21 DSGVO). Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.',
          ],
        },
      ],
    },
  },
  en: {
    imprint: {
      title: 'Legal notice',
      description: 'Information about the provider of the IMAP Transfer website.',
      updated: 'Last updated: October 2026',
      sections: [
        { heading: 'Information pursuant to § 5 DDG (German Digital Services Act)', paragraphs: [ADDRESS] },
        { heading: 'Contact', paragraphs: [`Phone: ${PHONE}\nEmail: ${EMAIL}`] },
        { heading: 'VAT identification number', paragraphs: [`pursuant to § 27 a of the German VAT Act (UStG): ${VAT}`] },
        {
          heading: 'Trademarks',
          paragraphs: [`${TRADEMARKS} are trademarks of their respective owners. IMAP Transfer is an independent project and is not affiliated with them.`],
        },
        {
          heading: 'Licenses',
          paragraphs: [
            `IMAP Transfer is free software under the [MIT license](${LICENSE}). The app is built on free software by others. The main building blocks:`,
            [
              '**ImapFlow** talks to the mail servers: © Postal Systems OÜ, MIT license.',
              '**libmime** and **mailsplit** read the messages: © Andris Reinman and Zone Media OÜ, MIT license.',
              '**Electron** with **Chromium** carries the desktop app: © GitHub Inc. and the Electron contributors, MIT license; Chromium under the BSD license and further free licenses.',
              '**Vue.js** and **Vue I18n** build the interface: © Evan You and kazuya kawaguchi, MIT license.',
              '**electron-updater** fetches new versions: © Loopline Systems, MIT license.',
              '**Commander** reads the commands of the command line: © TJ Holowaychuk, MIT license.',
            ].join('\n'),
            'Every installation contains the complete list of building blocks with their license texts, in the “licenses” folder among the app’s resources. The command line brings the license texts along with its packages.',
            `This website uses the typefaces Newsreader (© The Newsreader Project Authors) and Hanken Grotesk (© The Hanken Grotesk Project Authors) under the SIL Open Font License 1.1. The license texts sit next to the font files: [Newsreader](${FONT_LICENSES.newsreader}), [Hanken Grotesk](${FONT_LICENSES.hanken}).`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      description: 'How the website and the app IMAP Transfer handle data.',
      updated: 'Last updated: October 2026',
      sections: [
        {
          paragraphs: [
            'In short: this website sets no cookies, counts no visitors and loads nothing from other providers. The app IMAP Transfer runs on your computer; your mail and sign-in details stay there, and we receive no data from it.',
          ],
        },
        { heading: 'Controller', paragraphs: [`${ADDRESS}\n${EMAIL}`] },
        {
          heading: 'Visiting the website',
          paragraphs: [
            'When you visit the website, your browser transmits technically necessary information to the server of our hosting provider: IP address, date and time, the requested file and details about your browser and operating system. This information is processed only to deliver the website and keep it secure, and is stored only as long as necessary for that. The legal basis is our legitimate interest in secure operation (Art. 6(1)(f) GDPR).',
            `Our hosting provider is ${HOSTER}, Germany. We have concluded a data processing agreement with it under Art. 28 GDPR.`,
            'All files of the website, including the fonts, come from this server. No content is loaded from other providers, and no cookies are set.',
          ],
        },
        {
          heading: 'Downloads',
          paragraphs: [
            'The installers are served by the same server as this website. Downloading one transmits the same information as visiting a page, and what is said above applies. No other provider is involved.',
          ],
        },
        {
          heading: 'Checking a file',
          paragraphs: [
            'When you drop or choose a downloaded file on the checker, your browser computes its checksum on your device. The file is not transmitted, neither to us nor to anyone else.',
          ],
        },
        {
          heading: 'The app IMAP Transfer',
          paragraphs: [
            'IMAP Transfer runs on your computer. Mail, backups, sign-in details and settings stay there; passwords and sign-ins are stored encrypted in your system’s key store. The app connects to the mail servers you enter.',
            `If you choose “Sign in with Microsoft”, the app opens Microsoft’s sign-in page in your browser. Microsoft’s [privacy statement](${MICROSOFT_PRIVACY}) applies there.`,
            `When it starts, the app asks GitHub (${GITHUB_ADDRESS}) whether there is a newer version and, if so, downloads it. GitHub then receives your IP address and the technical details of the request and processes them under its own [privacy statement](${GITHUB_PRIVACY}). The legal basis is our legitimate interest in providing you with bug fixes and security updates (Art. 6(1)(f) GDPR).`,
            'Beyond that, the app sends nothing: no usage statistics, no crash reports, no account. We receive no data from the app.',
          ],
        },
        {
          heading: 'Contact by email',
          paragraphs: [
            'If you email us, we process your address and your message in order to answer your request. The legal basis is our legitimate interest in answering it (Art. 6(1)(f) GDPR). We delete the data once your request has been dealt with, unless statutory retention obligations apply.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You have the right of access, rectification, erasure and restriction of processing of your data and the right to data portability (Art. 15 to 20 GDPR). To exercise them, contact the email address given above. You can also lodge a complaint with a data protection supervisory authority, for example the State Commissioner for Data Protection and Freedom of Information of North Rhine-Westphalia.',
          ],
        },
        {
          heading: 'Right to object',
          paragraphs: [
            'Where we process your data on the basis of our legitimate interest (Art. 6(1)(f) GDPR), you may object to this at any time on grounds relating to your particular situation (Art. 21 GDPR). We will then no longer process the data unless we can demonstrate compelling legitimate grounds that override your interests, or the processing serves the establishment, exercise or defence of legal claims.',
          ],
        },
      ],
    },
  },
};
