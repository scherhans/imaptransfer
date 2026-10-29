# Architecture

```
apps/desktop      Electron + Vue: the app for everyone
apps/website      imaptransfer.com: landing page, download page with checksums, legal pages
packages/cli      command line: servers, NAS, cron
packages/core     the engine both of them use
```

The engine knows nothing about a user interface. Every operation takes an `AbortSignal` and reports progress as events; the desktop app and the command line only render them.

## Engine (`packages/core`)

| File | Job |
| --- | --- |
| `session.ts` | One IMAP connection (ImapFlow). The first connect fails fast; later connection or throttling errors reconnect with a growing pause (2 s … 60 s, a server's own request for a pause capped at 5 min) and repeat the interrupted step. A server that goes silent is given up after imapflow's 5 minutes of inactivity, then reconnected. |
| `errors.ts` | Sorts errors into what a job does about them. "Too many connections", `[UNAVAILABLE]`, `[INUSE]`, "temporarily", "try again" are a reason to wait, also when the server says it on login (imapflow flags any refused login as a bad password). `ENOSPC`, `EROFS`, `EIO` and SQLite's full/read-only/I/O codes are `storage` and end the run; `[LIMIT]` is a limit of one message, not a quota. |
| `backup.ts` | Account → backup folder, incremental. |
| `transfer.ts` | Backup → account (restore) and account → account (migrate). One code path for both, with an optional one-way sync. |
| `sync-memory.ts` | What a migration saw in each source folder, so a later sync can tell what left it. |
| `dedupe.ts` | Finds and removes exact copies of a message within one folder of an account. |
| `store/store.ts` | The backup on disk: `.eml` files plus an SQLite index (`node:sqlite`, no native build). |
| `fingerprint.ts` | Recognises a message across servers. |
| `folders.ts` | Folder roles and mapping from source to target folders. |
| `oauth.ts` | Microsoft (and Google) sign-in with PKCE and a loopback redirect. |
| `job.ts` | Cancellation, progress, the final report. |

### Recognising a message

IMAP UIDs only identify a message inside one folder on one server; after a move they mean nothing. The fingerprint is a SHA-256 over the normalised `Message-ID`, `Date`, sender address and decoded subject. It stays the same when a server re-folds headers, re-encodes a subject or writes the date in another time zone. A `Date` without a zone counts as UTC, so the fingerprint does not depend on the computer's time zone.

Without a `Message-ID`, the arrival time (in whole seconds) is added: script and device mail often shares sender, subject and even `Date`. A restore sets the arrival time explicitly, so it matches on the target. A message without any identifying header also uses its size.

Two messages with the same `Message-ID`, date, sender and subject count as one message, even if their bytes differ (a mailing list copy and the direct copy). That is intended.

Everything that avoids duplicates builds on it: the backup stores a message once, and restore and migration check the target folder before every upload.

### Copies within one folder

A folder can hold the same message several times: an interrupted sync or a migration run twice leaves such copies behind. The backup stores the file once and records every copy (one membership per UID), so a restore or migration puts back exactly as many copies as the folder held. It compares counts: a target folder that already has one of three copies gets two more, and a repeated run adds none. Further copies are made server-side with `COPY`, in rounds, because a UID set names a message only once; after a reconnect the engine counts which copies the interrupted attempt already made. Their flags are merged: read, answered or flagged on one copy counts for all.

Restore and migration never leave copies out: they bring back what the folder held. Copies are cleaned up only by the cleanup below, on purpose and after a test run.

### Backup

Per folder:

1. Open the folder read-only (`EXAMINE`), compare its `UIDVALIDITY` with the index. If the server renumbered the folder, all UIDs are forgotten and messages are linked again by fingerprint.
2. Fetch UIDs and flags of all messages (cheap even for 100 000 messages). Known UIDs only get their flags updated; UIDs that disappeared are marked as removed — their files stay.
3. For new UIDs fetch the four fingerprint headers. A message the backup already has (Gmail label, duplicate) is only linked to the folder; everything else is downloaded as a stream into `<file>.part`, hashed, renamed and recorded in one transaction.

Every folder of the account gets its directory under `mail/`, even an empty one or one whose messages are all stored under another folder, so the backup shows the same folders as the account. Subscriptions play no part: a folder hidden in the mail program is backed up like any other.

A dropped connection repeats the folder; already stored messages are skipped, so nothing is downloaded twice. imapflow answers a download with nothing both for a message deleted meanwhile and once the connection is gone; the engine tells them apart (`client.usable`, `client.mailbox`), so a connection lost between two downloads repeats the folder instead of counting the rest of the batch as deleted. A folder the server refuses (no permission, deleted meanwhile) is reported and skipped; the other folders go on, and the next run tries it again. One message the server cannot deliver (Dovecot `[SERVERBUG]`, Exchange `BAD`) fails alone: the batch fetch is halved until it stands by itself. A message the server lists but does not answer is checked once more and counted as failed, not as present. A failed message pulls the folder's `UIDNEXT` mark back to it, so the next run's plan does not skip the folder.

A full or read-only disk, an unreachable share and a database that refuses to write are `storage` errors: they end the run with a report instead of failing every remaining message one by one. A folder that is gone from the account is closed in the index: its mail stays, but a restore only recreates it when deleted mail is asked for.

A lock file keeps two processes from writing the same backup. The holder touches it every 30 seconds; a lock not touched for five minutes belongs to a process that died, on whichever computer, and is taken over. A process only ever removes its own lock (a random token in the file), and the lock is released even when recording the run fails. The backup folder itself is created when missing, never the folders above it: with an external drive not plugged in, a new full backup would otherwise land on the system disk. The database opens with a busy timeout, so a reader (the app's summary, `verify`) does not make a writer fail with "database is locked".

Every file is written with `fsync` before the index records it, and the directory is synced after the rename. A power cut can therefore not leave an index entry that points to an empty file.

Servers slip unsolicited `FETCH` responses into any command when another mail program changes flags at the same moment, and imapflow passes them on like answers. Every fetch keeps only rows for requested UIDs that carry the requested headers (`fetching.ts`).

### Restore and migration

1. Read the source: from the index (restore) or by fetching the fingerprint headers of every folder (migrate). Messages are grouped by fingerprint, each with all the folders it lives in.
2. Map source folders to target folders (see below) and create missing ones, parents first, empty folders included. Most servers create a missing parent on their own; when one refuses a folder because its parent is missing, the parents are created first. Then every target folder must show up in a fresh listing, and is subscribed: Thunderbird, Outlook and others hide a folder that is not.
3. Read the fingerprints of every target folder.
4. For each message: skip the folders that already hold enough copies of it; upload it once (`APPEND` with flags and original arrival date); make the further copies, in the same folder or in others, with a server-side `COPY` and fix flags if they differ.

After a reconnect, an upload or a copy first checks whether the interrupted attempt already arrived. A repeated run, a cancelled run and a run after a crash therefore never create duplicates. imapflow reports a failed `COPY` or `STORE` only as `false`; the engine checks whether the connection is still usable and turns a lost connection into a retry. Without UIDPLUS the server does not say where copies went, so the engine finds them by fingerprint to set their flags. A copy group that fails half-way credits the copies it made before failing the rest.

A target folder that refuses the upload (no right to add mail there) costs the message only that folder: the next folder takes it and anchors the copies. Folder names are matched the way most servers compare them, ignoring case and Unicode normalization: a backup's "Projects" goes into an existing "projects", in the server's spelling, instead of failing to create a second one. A folder that cannot be subscribed is reported, not failed.

In Gmail, a folder is a label, so a message is put into a folder once however many copies the source held, and "All Mail" is read before a message is restored into Trash or Spam: a message that lives on in the account must not be pulled into the trash by restoring an old copy of it.

During a migration, a UID could point to another message by the time it is downloaded, if the source folder was renumbered or recreated in between. The source folder's `UIDVALIDITY` is checked again before every download, and the downloaded message must have the fingerprint the scan saw: not every server changes `UIDVALIDITY` when a folder is recreated (GreenMail keeps it within the same second). Some servers send the requested header fields re-encoded (GreenMail turns UTF-8 into Latin-1) while the full message keeps its bytes; on a mismatch the header fields of that one message are therefore read again the way the scan read them.

imapflow opens a folder it has not listed yet by sending its name as a `LIST` pattern, where `*` and `%` are wildcards. Every connection therefore lists the folders once, so a folder called `*wichtig*` opens like any other, also after a reconnect.

In Gmail, putting a message into Trash or Spam removes it from every other label. A message that also lives in another folder is therefore never copied into the Gmail trash or spam folder.

### One-way sync

A restore or a migration can also sync the target with the source, in one direction. Everything a plain run does happens first; then read and flagged of the messages already there follow the source (every other flag and keyword of the target stays), and what left a source folder leaves its target folder. Nothing ever flows back.

What "left" means is the heart of it: a message leaves the target only when the source folder held it before and holds it no more. Mail the source never held stays, such as mail that arrives in the new account after the address was switched over, or mail sent from it. A sync is therefore never "make the target equal to the source".

- **Restore:** the backup knows what left a folder. A message whose every copy in a folder is marked as removed there was deleted or moved in the account after it was backed up (`BackupStore.removedFrom`). That only holds once a backup run got through: an interrupted run has not linked every message of a reopened folder again yet. A run marks itself as begun in the index and clears the mark when it is recorded, so a crashed run does not pass for the previous one. A sync therefore needs a last backup run that completed, and a folder that run could not get through (an error, a failed message) counts as uncertain. A sync and `includeRemoved` exclude each other.
- **Migration:** the source has no history, so migrations of a pair of accounts keep one (`SyncMemory`, an SQLite file): the fingerprints each source folder held. A sync takes out what the memory knows and the folder no longer holds, then forgets it. A run without sync only adds to the memory, so a later sync also takes out what left the source in between. The first run with an empty memory takes nothing out. A memory belongs to one pair of accounts (user and host of both); opened for another pair it starts afresh instead of deleting by another account's history.
- Only folders that were read count. A source folder that is missing or left out keeps its target folder as it is; so does an uncertain one (unreadable in a migration, see above for a restore), and then the target folder also keeps what other source folders mapped there lost: a folder that cannot be seen must not look empty. A target folder that two source folders map to keeps what either still holds.
- What leaves a target folder goes to the trash, from where it can be brought back. Nothing is ever expunged: a folder the server does not mark as a view can still be one, and expunging from it would delete the real message. A message moved in the source therefore leaves its old copy in the target's trash. That copy goes only once the message has arrived at its new place, in a real folder: a view such as All Mail (by the target's own mark) may show the very copy that is about to go. Until then it waits, and stays remembered for the next sync (`waysOut`). The target's trash, spam and view folders are never touched.
- Removals come after all uploads and copies, so a moved message is copied server-side from its old place before it leaves it, and a run that fails half-way has added before it took anything out. Each folder is read again right before; repeating it after a reconnect finds the rest. The memory is only written once the run got through, and keeps what could not be taken out yet.
- Known limit: a virtual folder the server does not mark (Dovecot's virtual plugin, configured the same on both sides) looks like a real folder. A sync may then move a message out of it, and the server moves the real message into the trash. The source still holds it, so the next sync brings it back; nothing is lost, but the trash gets a copy.
- A sync is refused before any mail changes when the target has no trash, when its server can neither move nor delete single messages safely (no MOVE, no UIDPLUS), when the target is Gmail (there a folder is a label, and taking a message out of one could take it out of all), and for a restore when the last backup run did not complete.

### Progress and time left

Before transferring, every operation plans its work: how many messages have to cross the network, and how many bytes. A backup asks each folder for UIDs and sizes above the UIDNEXT of its last complete run; a folder whose UIDNEXT did not move is not even opened. In Gmail, X-GM-MSGID keeps a message under several labels from counting twice. Restore and migration know the sizes from the index or the scan, and count only messages that need an upload.

The estimate (`estimate.ts`) fits *seconds = time per message + size × time per byte* over the recent messages, with older ones fading out. Many small messages are slowed down by round trips, a few large ones by bandwidth; a mailbox has both, so neither the number of messages nor the bytes alone would do. The bandwidth is measured directly while large messages stream. Steps that serve several messages at once (fetching the headers of a batch, opening a folder) are spread over those messages, and a single outlier such as a pause after a dropped connection is capped. Measured against GreenMail behind a slowed-down connection, the estimate stays within about 15 % of the actual time left.

Messages of 1 MB and more report their own progress:

- **Download:** imapflow fetches a message in parts. Its default of 64 KB costs one round trip per part; imaptransfer asks for 1 MB parts (smaller messages in one piece), which gives the progress its steps and saves round trips.
- **Upload:** imapflow hands a whole message to the connection in one write, and Node passes it on as one block, so no counter moves until the end. While a large APPEND runs, `upload-meter.ts` passes the writes on in 256 KB slices, each after the previous one reached the network stack, and counts them. With COMPRESS active it measures in front of the compressor, in uncompressed bytes. Measured on a 20 MB upload: same speed, identical bytes. It relies on imapflow's internal `writeSocket`; without it, uploads run without progress.

### Folder mapping

- `INBOX` → `INBOX`.
- Special folders (Sent, Drafts, Trash, Junk, Archive) → the target's folder of the same kind, whatever it is called there ("Gesendet", "[Gmail]/Gesendet", "Sent Items"). Their subfolders move along.
- Everything else keeps its path. Namespace prefixes (`INBOX.` on Courier and Cyrus) are removed and added as needed, the hierarchy separator is converted, and a separator character inside a folder name becomes `_`.
- Gmail's "All Mail" is backed up, but restored only for messages that live in no other folder (archived mail). "Starred" and "Important" are views; they are skipped and the information is kept as a flag.

Only folders the server itself marks as special count as views. A user folder called "Starred" is a normal folder.

### Cleaning up duplicates (`dedupe.ts`)

Next to a sync, the only operation that removes mail from an account, so it is careful:

- Only exact copies within one folder count: the same fingerprint and the same size. A message with the same headers but another size is another version (an attachment removed, a footer added) and stays. The same message in two folders is not a duplicate.
- Trash, spam, drafts, "All Mail" and views are left alone, also a folder that is only *named* like one ("Deleted Items" next to "Trash"): a server without SPECIAL-USE marks one folder per kind at most.
- The oldest copy stays and first gets the flags of all copies, so nothing read, answered or flagged gets lost.
- The other copies go to the trash, from where they can be brought back. That holds in Gmail too: deleting from a label instead could be final there, depending on the account's settings.
- Without MOVE, imapflow copies, flags as deleted and expunges, and without UIDPLUS that expunge would remove every message marked as deleted in the folder. A server with neither (or an account without a trash folder) is refused with an explanation.
- Every folder is read again right before it is cleaned up, and a folder is safe to repeat after a reconnect: removed copies are gone, the rest is found again.

## Backup format

```
<backup>/
  README.txt
  imaptransfer.db
  mail/<folder>/<yyyy-mm-dd>_<subject>_<fingerprint prefix>.eml
```

File and folder names are valid on Windows, macOS and Linux (reserved names, forbidden characters, trailing dots). Names that differ only in case get their own directory, because macOS and Windows treat them as the same.

`imaptransfer.db` tables: `folders` (path, separator, special use, UIDVALIDITY, directory), `messages` (fingerprint, file, SHA-256, size, dates, subject), `memberships` (message in folder: UID, flags, removed since), `runs` (reports). The schema version is in `PRAGMA user_version`.

The database uses SQLite's default rollback journal instead of WAL, so a backup on a network share (SMB, NFS) works.

## Desktop app (`apps/desktop`)

- `src/main`: account storage (secrets encrypted with Electron `safeStorage`; the file is written with fsync and rename, a damaged file is kept aside and reported instead of being overwritten), the job runner (one job at a time, keeps the computer awake, progress in the dock/taskbar; a backup is refused when the folder that held the account's last backup holds none any more, a drive not plugged in, instead of starting anew on the system disk; a newly chosen folder starts afresh, because the last backup remembers its folder), Microsoft sign-in, updates via GitHub Releases. Every request from the window is checked before it starts a job. Quitting with a running job cancels it and waits for it to close its connections and record the run. A promise nobody handles is logged, never shown as an error dialog. The application menu (`menu.ts`) holds only what the app has: on macOS the app menu, Edit (copy and paste in text fields need it) and Window with Minimize and Close; on Windows and Linux there is no menu bar. There is no Help menu, because macOS would put a search field into it that finds nothing, and no View menu: reload, zoom and developer tools are for development, and packaged builds switch the developer tools off. The items macOS adds on its own (dictation, emoji, full screen) are turned off before launch. Every migration keeps a sync memory per pair of accounts in `sync/` next to the accounts; removing an account removes its memories. Look (system, light, dark) and language (system or one of the seven) are picked at the foot of the sidebar, the order of the accounts (by address or by provider) at the head of the list, and all three are kept in `settings.json` next to the accounts (`settings.ts`); the look goes through `nativeTheme.themeSource`, which also drives `prefers-color-scheme` in the window, and the menu, dialogs and notifications follow the chosen language. The test run of the cleanup streams its progress (phase, folder, mails checked) to the window and stops when the dialog closes. Known conflicts (a folder of another account, a missing drive, a backup of another version) carry a code and details from the core (`ConflictError.conflict`), so the window says them in its language; across IPC they travel in the error message behind `CONFLICT_MARK`.
- `src/preload`: the only bridge to the window (`window.imaptransfer`); sandboxed, context-isolated.
- `src/renderer`: Vue 3 with vue-i18n (German, English), no UI library.

The main process bundles the engine and all dependencies, so the packaged app contains no `node_modules`.

## Tests

- Unit tests (`node --test`, TypeScript run directly by Node).
- Integration tests against GreenMail, a real IMAP server in Java: backup, incremental backup, restore, migration, a deep folder tree with awkward names, copies within a folder and their cleanup, one-way sync (restore and migration, a target without trash, a cut connection while taking mail out), cancellation and resume, connection loss in the middle of a backup, a restore, server-side copies and a cleanup (through a proxy that cuts the connection after a number of bytes or right after a given server answer).
- End-to-end test of the built desktop app (`apps/desktop/test/e2e.mjs`): it fills in the forms like a user and checks backup, check, migration and restore.
