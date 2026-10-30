/**
 * Where the website lives and where the source code of IMAP Transfer is. The app's README, its
 * updater and the release workflow name the same repository; if it moves, they move together.
 */
export const SITE = {
  url: 'https://imaptransfer.com',
  repo: 'sebastian-scherhans/imaptransfer',
  email: 'hello@imaptransfer.com',
  /** Voluntary support: a plain link, the site loads nothing from there. */
  support: 'https://buymeacoffee.com/scherhans',
} as const;

export const githubUrl = (path = '') => `https://github.com/${SITE.repo}${path}`;
