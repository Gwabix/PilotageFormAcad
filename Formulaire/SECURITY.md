# 🔐 Guide de Sécurité - Widget Formulaire Grist

## 📋 Checklist avant chaque commit

- [ ] Toute variable dynamique dans un template literal passe par `escapeHtml()` ou `escapeHtmlAttribute()`
- [ ] Les nombres provenant d'inputs sont validés avec `safeParseInt()`
- [ ] Les chaînes de caractères utilisateur passent par `validateInput()`
- [ ] Les données provenant de l'API Grist passent par `sanitizeGristData()`
- [ ] Aucun `innerHTML` ajouté sans annotation `// nosemgrep` et commentaire de sécurité

---

## 🛡️ Fonctions de Sécurité Disponibles

### `escapeHtml(text)`
**Usage** : Échapper du contenu HTML (texte affiché)

```javascript
// ✅ BON
container.innerHTML = `<div>${escapeHtml(user.name)}</div>`;

// ❌ MAUVAIS
container.innerHTML = `<div>${user.name}</div>`;
```

### `escapeHtmlAttribute(text)`
**Usage** : Échapper des valeurs d'attributs HTML

```javascript
// ✅ BON
input.innerHTML = `<input value="${escapeHtmlAttribute(user.email)}">`;

// ❌ MAUVAIS
input.innerHTML = `<input value="${user.email}">`;
```

### `validateInput(input, maxLength)`
**Usage** : Nettoyer les entrées utilisateur (supprime caractères de contrôle)

```javascript
// ✅ BON
const nom = validateInput(document.getElementById('nom').value, 100);

// ❌ MAUVAIS
const nom = document.getElementById('nom').value;
```

### `safeParseInt(value, defaultValue, min)`
**Usage** : Parser un nombre de manière sécurisée

```javascript
// ✅ BON
const age = safeParseInt(input.value, 0, 0);

// ❌ MAUVAIS
const age = parseInt(input.value) || 0;  // Risque avec NaN
```

### `sanitizeGristData(value)`
**Usage** : Nettoyer les données provenant de l'API Grist

```javascript
// ✅ BON (déjà appliqué dans loadData())
nom: sanitizeGristData(table.Nom[index])

// ❌ MAUVAIS
nom: table.Nom[index]
```

---

## ⚠️ Zones à Haut Risque

### 1️⃣ Formulaire d'édition (ligne ~1365)
- **171 lignes** de template HTML
- **40+ variables** dynamiques
- **Toutes échappées** actuellement
- ⚠️ **Attention** lors de l'ajout de nouveaux champs

### 2️⃣ Liste des enseignants (ligne ~422)
- Template imbriqué (map dans map)
- **36 points d'échappement**
- Risque d'oubli sur nouveaux champs

### 3️⃣ Badges de filtres (ligne ~1250)
- Variables multiples par filtre
- Vérifier chaque nouveau type de filtre

---

## 🚨 Scénarios d'Attaque à Connaître

### XSS via données Grist
**Si un utilisateur entre dans Grist** :
```
<img src=x onerror="alert('XSS')">
```

**Protection** : Toutes les données Grist passent par `sanitizeGristData()` dans `loadData()`

### XSS via formulaire
**Si un utilisateur entre dans un input** :
```
"><script>alert(1)</script>
```

**Protection** : Utiliser `validateInput()` + `escapeHtmlAttribute()` pour les attributs

### Injection via template literal
**Code vulnérable** :
```javascript
container.innerHTML = `<div data-id="${newField}">${newValue}</div>`;
```

**Code sécurisé** :
```javascript
container.innerHTML = `<div data-id="${escapeHtmlAttribute(newField)}">${escapeHtml(newValue)}</div>`;
```

---

## ✅ Tests de Sécurité

Les tests automatiques s'exécutent au chargement du script (fin de `form.js`).

**Vérifier dans la console** :
```
✅ Tests de sécurité : 10/10 réussis
```

**En cas d'échec**, les tests affichent les erreurs détaillées.

---

## 📚 Ressources

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [MDN: innerHTML security](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML#security_considerations)

---

## 🎯 Règle d'Or

> **Jamais de données dynamiques dans un template HTML sans échappement explicite.**

Si tu hésites : **échappe toujours**.
