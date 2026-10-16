// Où vivent les comptes : Firebase si un projet est configuré (config.js), sinon l'API PHP.
import { FIREBASE } from './config.js';
import { phpBackend } from './backends/php.js';
import { createFirebaseBackend } from './backends/firebase.js';

export const backend = FIREBASE.apiKey && FIREBASE.projectId ? createFirebaseBackend(FIREBASE) : phpBackend;
