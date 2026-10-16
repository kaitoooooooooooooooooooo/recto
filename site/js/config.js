// Comptes. Avec un projet Firebase (Authentication + Firestore), les comptes et les listes passent
// par lui : le site peut alors être un simple hébergement statique. Sans, Recto utilise son API PHP
// (site/api), qui demande un hébergement avec PHP 8.1+.
//
// Ces deux valeurs ne sont pas secrètes : elles désignent le projet. Ce sont les règles Firestore
// (firestore.rules, à la racine du dépôt) qui protègent les données de chacun.
export const FIREBASE = {
  apiKey: '',
  projectId: '',
};
