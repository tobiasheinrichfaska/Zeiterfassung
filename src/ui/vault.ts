import { createVault, type VaultConfig, type VaultEnvironment } from 'local-vault';
import { VAULT_SLOTS } from '../logic/index.ts';

/**
 * The app's vault: prefix and slots are fixed for good (a changed prefix makes stored data unreadable).
 * Besides the book and the draft: two slots for the running monthly PDFs (`monatspdf-a`, `monatspdf-b`:
 * current and previous month). The slot
 * `geraeteschluessel` holds the device key for the time stamp relay (never in plain browser storage).
 */
export const vaultConfig: VaultConfig = {
  prefix: 'zeiterfassung',
  slots: [...VAULT_SLOTS],
  texts: {
    title: 'Zeiterfassung',
    opening: 'Die Daten werden geöffnet …',
    lockedTitle: 'Gesperrt',
    passwordLabel: 'Passwort',
    unlockButton: 'Entsperren',
    unlocking: 'Wird geöffnet …',
    wrongPassword: 'Falsches Passwort.',
    forgottenHint:
      'Passwort vergessen? Ohne Passwort lassen sich die Daten auf diesem Gerät nicht öffnen. ' +
      '„Neu beginnen“ verwirft sie und richtet das Gerät neu ein. Was nur hier gespeichert war, ist dann weg.',
    startAnewButton: 'Neu beginnen',
    startAnewConfirmLocked: 'Alle Daten auf diesem Gerät verwerfen und das Gerät neu einrichten?',
    errorTitle: 'Daten nicht geöffnet',
    errorHint:
      'Die Daten bleiben unverändert. Erst wenn Sie sie aufgeben: „Neu beginnen“ verwirft sie und ' +
      'richtet das Gerät neu ein.',
    startAnewConfirmError: 'Die Daten auf diesem Gerät endgültig verwerfen und neu beginnen?',
    dismissErrors: 'Gelesen',
    lockTitle: 'App-Sperre',
    lockOnInfo: (minutes) =>
      `Die Sperre ist an: Die App fragt beim Start und nach ${minutes} Minuten im Hintergrund nach dem Passwort.`,
    lockOffInfo:
      'Die Sperre ist aus: Die Daten sind verschlüsselt, öffnen sich aber ohne Passwort. Mit Sperre schützt ein Passwort sie zusätzlich.',
    currentPassword: 'Aktuelles Passwort',
    newPassword: 'Neues Passwort',
    repeatPassword: 'Passwort wiederholen',
    turnOnButton: 'Sperre einschalten',
    changePasswordButton: 'Passwort ändern',
    turnOffButton: 'Sperre ausschalten',
    lockNowButton: 'Jetzt sperren',
    busy: 'Einen Moment …',
    lockTurnedOn: 'Die Sperre ist eingeschaltet.',
    passwordChanged: 'Das Passwort wurde geändert.',
    lockTurnedOff: 'Die Sperre ist ausgeschaltet.',
    notStarted: 'Die Daten wurden noch nicht gestartet.',
    notOpen: 'Die Daten sind nicht geöffnet.',
    slotUnreadable: 'Diese Daten konnten nicht gelesen werden.',
    notSavedUnreadable:
      'Nicht gespeichert: Die vorhandenen Daten konnten nicht gelesen werden und bleiben unverändert.',
    notSaved: (reason) => `Nicht gespeichert: ${reason}`,
    dataUnreadable: 'Die gespeicherten Daten konnten nicht gelesen werden.',
    keyDamaged: 'Der Schlüssel auf diesem Gerät ist beschädigt.',
    keyMismatch: 'Der Schlüssel passt nicht zu den gespeicherten Daten.',
    storageUnreachable: (reason) => `Der Speicher dieses Geräts ist nicht erreichbar: ${reason}`,
    wrongCurrentPassword: 'Das aktuelle Passwort ist falsch.',
    passwordTooShort: (min) => `Das Passwort braucht mindestens ${min} Zeichen.`,
    passwordsDiffer: 'Die beiden Passwörter sind verschieden.',
    indexedDbUnavailable: 'Der Gerätespeicher (IndexedDB) ist nicht verfügbar.',
    vaultUnreachable: 'Der Tresor ist nicht erreichbar.',
    vaultNotStored: 'Der Tresor konnte nicht gespeichert werden.',
  },
};

/** `env` is for tests (memory); the app uses the browser. */
export const createAppVault = (env?: VaultEnvironment) => createVault(vaultConfig, env);

export const vault = createAppVault();
