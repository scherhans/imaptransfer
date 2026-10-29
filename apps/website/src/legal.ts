import { githubUrl, SITE } from './config.ts';
import type { Lang } from './content.ts';
import { LIABILITY, liabilityPath } from './paths.ts';

// Legal notice and privacy policy. The operator's details and the paragraphs on hosting, email and
// rights follow those of textcolumn.com, the operator's other site; the parts on downloads, the
// checksum checker, the app and its building blocks are this site's own. Inline marks as in
// content.ts; a link to a path of this site ("/assets/…") becomes relative on each page.

export type LegalKind = 'imprint' | 'privacy';

export interface LegalSection {
  heading?: string;
  /** An anchor, for links to this section from other pages. */
  id?: string;
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
const SUPPORT_SERVICE = 'Publisherr, Inc., 2193 Fillmore Street, San Francisco, CA 94115, USA';
const SUPPORT_PRIVACY = 'https://buymeacoffee.com/privacy-policy';
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
        {
          heading: 'Haftung für die App',
          id: LIABILITY.de,
          paragraphs: [
            'IMAP Transfer wird kostenlos und so bereitgestellt, wie es ist: ohne Gewähr dafür, dass die App fehlerfrei läuft oder für Ihren Zweck taugt. So steht es auch in der MIT-Lizenz. Soweit deutsches Recht gilt, haften wir wie bei einer Schenkung: nur für Vorsatz und grobe Fahrlässigkeit (§ 521 BGB) und für Mängel der App nur, wenn wir sie arglistig verschwiegen haben (§ 524 BGB). Das gilt auch für den Verlust oder die Veränderung von Mails und anderen Daten. Unberührt bleibt die Haftung, die das Gesetz zwingend vorschreibt, etwa nach dem Produkthaftungsgesetz.',
            'Wiederherstellen, Umziehen, Abgleichen und Aufräumen schreiben in ein Postfach; Abgleichen und Aufräumen verschieben dabei Mails in den Papierkorb. Fehler von Servern, Verbindungen oder der App lassen sich nie ganz ausschließen. Sichern Sie Ihre Mails deshalb vor jedem dieser Schritte, und prüfen Sie danach das Ergebnis. Die Sicherung kann IMAP Transfer selbst anlegen.',
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
            `IMAP Transfer wird so bereitgestellt, wie es ist, und für Datenverlust haften wir nur beschränkt. Die Einzelheiten stehen im Impressum unter [Haftung für die App](${liabilityPath('de')}).`,
          ],
        },
        {
          heading: 'Unterstützen über Buy Me a Coffee',
          paragraphs: [
            `Die Links zum Unterstützen führen zu Buy Me a Coffee, einem Dienst der ${SUPPORT_SERVICE}. Die Website bindet davon nichts ein. Erst wenn Sie einem dieser Links folgen, erhält der Dienst Daten von Ihnen, und es gilt seine [Datenschutzerklärung](${SUPPORT_PRIVACY}). Die Zahlung wickelt dort Stripe ab.`,
            'Unterstützen Sie uns dort, übermittelt uns Buy Me a Coffee Ihren Namen oder Anzeigenamen, Ihre E-Mail-Adresse, Betrag und Datum sowie Ihre Nachricht, falls Sie eine schreiben. Wir nutzen diese Angaben, um die Zahlung zu verbuchen und Ihnen gegebenenfalls zu antworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, für die Buchhaltung Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit den steuerrechtlichen Aufbewahrungspflichten. Wir bewahren die Angaben so lange auf, wie diese Pflichten es verlangen.',
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
        {
          heading: 'Liability for the app',
          id: LIABILITY.en,
          paragraphs: [
            'IMAP Transfer is provided free of charge and as is: without any warranty that the app works without errors or suits your purpose. The MIT license says the same. Where German law applies, we are liable as for a gift: only for intent and gross negligence (Section 521 BGB), and for defects of the app only if we fraudulently concealed them (Section 524 BGB). This also applies to the loss or alteration of mail and other data. Liability that the law makes mandatory, such as under the German Product Liability Act, remains unaffected.',
            'Restoring, migrating, syncing and cleaning up write to a mailbox; syncing and cleaning up move messages to the trash. Errors of servers, connections or the app can never be ruled out entirely. Back up your mail before each of these steps, and check the result afterwards. IMAP Transfer can make this backup itself.',
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
            `IMAP Transfer is provided as is, and our liability for data loss is limited. The details are in the legal notice under [Liability for the app](${liabilityPath('en')}).`,
          ],
        },
        {
          heading: 'Support via Buy Me a Coffee',
          paragraphs: [
            `The links to support IMAP Transfer lead to Buy Me a Coffee, a service of ${SUPPORT_SERVICE}. The website embeds nothing of it. Only when you follow one of these links does the service receive data from you, and its [privacy policy](${SUPPORT_PRIVACY}) applies. Payments there are processed by Stripe.`,
            'If you support us there, Buy Me a Coffee passes on to us your name or display name, your email address, the amount and date, and your message if you write one. We use this information to book the payment and, where appropriate, to reply to you. The legal basis is Art. 6(1)(b) GDPR, and for bookkeeping Art. 6(1)(c) GDPR together with the retention obligations of tax law. We keep the information as long as these obligations require.',
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
