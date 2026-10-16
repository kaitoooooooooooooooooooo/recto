// Compte : connexion, inscription ; une fois connecté, déconnexion et suppression du compte.
import { h, toast, confirmDialog, plural } from '../ui.js';
import * as store from '../store.js';

const ERR = {
  username_invalid: 'Pseudo : 3 à 20 caractères, lettres, chiffres, « _ », « . » ou « - ».',
  username_taken: 'Ce pseudo est déjà pris.',
  email_invalid: 'Adresse e-mail invalide.',
  email_taken: 'Un compte existe déjà avec cette adresse.',
  password_short: 'Mot de passe : 8 caractères au moins.',
  password_long: 'Mot de passe trop long.',
  password_weak: 'Le mot de passe ne doit pas être ton pseudo ni ton adresse.',
  bad_credentials: 'Identifiant ou mot de passe incorrect.',
  rate_limited: 'Trop d’essais. Réessaie dans un quart d’heure.',
  network: 'Pas de connexion au serveur.',
  https_required: 'Les comptes ne fonctionnent qu’en connexion sécurisée (https).',
  server_error: 'Erreur du serveur. Réessaie plus tard.',
};
const msg = (code) => ERR[code] || ERR.server_error;

function field(id, label, input, hint) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint label' }, hint) : null, h('span', { class: 'field-error', 'data-for': id }));
}

export function renderAccount(ctx) {
  const u = store.currentUser();
  if (u) return loggedIn(ctx, u);
  if (!store.accountsAvailable()) {
    ctx.root.append(h('section', { class: 'page-head' }, h('h1', {}, 'Compte')),
      h('p', { class: 'lede' }, 'Les comptes ne sont pas disponibles ici pour le moment : le serveur ne répond pas. Tes listes restent enregistrées dans ce navigateur, sur cet appareil seulement.'),
      h('p', { class: 'lede narrow' }, 'Elles ne sont pas perdues : dès que les comptes fonctionneront, connecte-toi depuis cet appareil et elles rejoindront ton compte. N’efface pas les données de ce site dans le navigateur d’ici là.'));
    return;
  }
  const mode = ctx.query.get('m') === 'inscription' ? 'register' : 'login';
  const general = h('p', { class: 'form-error', role: 'alert' });
  const showErrors = (form, err) => {
    form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
    general.textContent = '';
    if (err.fields) for (const [k, v] of Object.entries(err.fields)) { const el = form.querySelector(`[data-for="f-${k}"]`); if (el) el.textContent = msg(v); }
    else general.textContent = msg(err.code);
  };
  const done = (moved) => {
    toast(moved ? `Connecté·e. ${plural(moved, 'liste de cet appareil ajoutée', 'listes de cet appareil ajoutées')} à ton compte.` : 'Connecté·e.');
    ctx.go('/');
  };

  let form;
  if (mode === 'register') {
    const username = h('input', { id: 'f-username', type: 'text', autocomplete: 'username', required: true, maxlength: 20 });
    const email = h('input', { id: 'f-email', type: 'email', autocomplete: 'email', required: true, maxlength: 190 });
    const password = h('input', { id: 'f-password', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
    form = h('form', {
      class: 'auth',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try { done(await store.register(username.value, email.value, password.value)); } catch (err) { showErrors(form, err); btn.disabled = false; }
      },
    },
    field('f-username', 'Pseudo', username, '3 à 20 caractères'),
    field('f-email', 'Adresse e-mail', email),
    field('f-password', 'Mot de passe', password, '8 caractères au moins'),
    general,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Créer mon compte'),
    h('p', { class: 'switch label' }, 'Déjà un compte ? ', h('a', { href: '#/compte' }, 'Se connecter')));
  } else {
    const login = h('input', { id: 'f-login', type: 'text', autocomplete: 'username', required: true });
    const password = h('input', { id: 'f-password', type: 'password', autocomplete: 'current-password', required: true });
    form = h('form', {
      class: 'auth',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try { done(await store.login(login.value, password.value)); } catch (err) { showErrors(form, err); btn.disabled = false; }
      },
    },
    field('f-login', 'Pseudo ou adresse e-mail', login),
    field('f-password', 'Mot de passe', password),
    general,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Se connecter'),
    h('p', { class: 'switch label' }, 'Pas encore de compte ? ', h('a', { href: '#/compte?m=inscription' }, 'Créer un compte')));
  }
  ctx.root.append(
    h('section', { class: 'page-head' }, h('h1', {}, mode === 'register' ? 'Créer un compte' : 'Se connecter')),
    h('p', { class: 'lede narrow' }, 'Avec un compte, tes listes et ta progression te suivent sur tous tes appareils. Les listes faites sans compte sur cet appareil y sont ajoutées.'),
    form);
  form.querySelector('input').focus();
}

function loggedIn(ctx, u) {
  ctx.root.append(
    h('section', { class: 'page-head' }, h('h1', {}, u.username)),
    h('div', { class: 'stack' },
      h('p', { class: 'label muted' }, u.email, ' · ', plural(store.allSets().length, 'liste', 'listes')),
      h('button', { class: 'btn', type: 'button', onclick: async () => { await store.logout(); toast('Déconnecté·e.'); ctx.go('/'); } }, 'Se déconnecter')),
    h('section', { class: 'danger-zone' },
      h('details', {},
        h('summary', { class: 'linklike danger' }, 'Supprimer mon compte'),
        (() => {
          const pw = h('input', { id: 'f-del', type: 'password', autocomplete: 'current-password', required: true });
          const err = h('p', { class: 'form-error', role: 'alert' });
          const f = h('form', {
            class: 'auth',
            onsubmit: async (e) => {
              e.preventDefault();
              if (!(await confirmDialog('Supprimer ton compte et toutes tes listes ? C’est définitif.', { ok: 'Supprimer', danger: true }))) return;
              try { await store.deleteAccount(pw.value); toast('Compte supprimé.'); ctx.go('/'); } catch (x) { err.textContent = msg(x.code); }
            },
          }, h('p', { class: 'label' }, 'Le compte et toutes ses listes seront effacés du serveur.'), field('f-del', 'Mot de passe', pw), err,
          h('button', { class: 'btn danger', type: 'submit' }, 'Supprimer définitivement'));
          return f;
        })())));
}
