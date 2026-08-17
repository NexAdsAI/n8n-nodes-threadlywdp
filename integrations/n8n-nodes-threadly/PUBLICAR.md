# Publicar `n8n-nodes-threadlywdp` en npm con procedencia

Procedimiento exacto, en orden. Sirve para la 0.1.0 y para cada version
siguiente. Al final hay un apartado con lo que se rompe si algun paso se saltea.

Contexto de por que existe este documento: desde el **1 de mayo de 2026** n8n
solo verifica nodos community publicados **desde una GitHub Action y con
declaracion de procedencia**. Ya no acepta paquetes subidos a mano desde una
laptop. La procedencia es una firma criptografica que ata el tarball publicado a
un repositorio, un commit y un workflow concretos; GitHub la emite con OIDC y se
registra en el log de transparencia publico de Sigstore.

---

## Paso 0. Condicion previa que decide todo lo demas

**La procedencia exige un repositorio de GitHub PUBLICO, y la URL de ese
repositorio tiene que coincidir con `repository.url` del `package.json`.**

Hoy el `package.json` declara:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/NexAdsAI/n8n-nodes-threadlywdp.git",
  "directory": "integrations/n8n-nodes-threadlywdp"
}
```

El registro de npm compara esa URL contra el repositorio desde el que corrio el
workflow. Si no calzan, **rechaza la publicacion** aunque todo lo demas este
bien. Y la atestacion se escribe en un log publico, asi que un repositorio
privado no sirve.

El monorepo de Threadly (`NexAdsAI/Threadly-WDP`) es privado y va a seguir
siendolo. Por lo tanto hay que elegir **una** de estas dos opciones antes de
tocar nada mas:

| Opcion | Que hay que hacer | Que hay que ajustar |
| --- | --- | --- |
| **A (recomendada).** Repositorio publico dedicado `NexAdsAI/n8n-nodes-threadlywdp`, con el paquete en `integrations/n8n-nodes-threadlywdp/` | Crear el repo publico y espejar ahi esa carpeta mas `.github/workflows/publicar-nodo-n8n.yml` | Nada. `package.json` y el workflow ya asumen este layout. |
| **B.** Mismo repositorio publico pero con el paquete en la **raiz** | Crear el repo publico y copiar el contenido de la carpeta a la raiz | Quitar `repository.directory` del `package.json` y quitar el bloque `defaults.run.working-directory` del workflow. |

El resto de este documento asume la **opcion A**.

Lo que se publica es solo el paquete: el codigo de la plataforma Threadly no
entra al repositorio publico. Revisar eso antes del primer push es parte del
Paso 3.

---

## Paso 1. Cargar el secret de npm en GitHub

1. Entrar a [npmjs.com](https://www.npmjs.com) con la cuenta que va a ser duena
   del paquete y abrir **Access Tokens** (menu del avatar > *Access Tokens*).
2. **Generate New Token > Granular Access Token**.
   - *Expiration*: lo mas corto que sea operable (90 dias es razonable; anotar
     la fecha, porque cuando vence el workflow falla con `E401` y no es obvio).
   - *Packages and scopes*: permiso **Read and write**. Para la primera
     publicacion el paquete todavia no existe, asi que hay que dar alcance a
     todos los paquetes de la cuenta (*All packages*); despues de publicar
     conviene reemplazar el token por uno acotado solo a `n8n-nodes-threadlywdp`.
   - No hace falta ningun permiso de organizacion ni de usuario.
3. Copiar el token. Se muestra **una sola vez**.
4. En GitHub, en el repositorio **publico** (`NexAdsAI/n8n-nodes-threadlywdp`):
   **Settings > Secrets and variables > Actions > New repository secret**.
   - *Name*: `NPM_TOKEN` (exactamente asi; es el nombre que lee el workflow).
   - *Secret*: el token pegado.

> **Alternativa sin token: Trusted Publishers.** npm permite autorizar
> directamente a un workflow de GitHub, sin secretos de larga vida ni
> vencimientos. Se configura en npmjs.com, en los ajustes del paquete >
> *Publishing access* > *Trusted Publishers* > *Add a publisher*, indicando
> propietario del repo, nombre del repo y nombre del archivo de workflow
> (`publicar-nodo-n8n.yml`). Requiere que el paquete **ya exista** en npm y que
> el runner use npm 11.5.1 o superior, asi que no sirve para la primera
> publicacion. Recomendado migrar a esto despues de la 0.1.0 y borrar el
> `NPM_TOKEN`.

---

## Paso 2. Verificar el paquete en local

Desde `integrations/n8n-nodes-threadlywdp/`:

```bash
npm ci                  # instala exactamente lo del lockfile
npm run lint            # tsc --noEmit
npm run build           # compila a dist/ y copia iconos y codex
npm pack --dry-run      # lista que archivos entran al tarball
```

Para la 0.1.0, `npm pack --dry-run` muestra **15 archivos, ~20.8 kB**:
`CHANGELOG.md`, `LICENSE`, `README.md`, `index.js`, `package.json` y `dist/`
(los `.js`, los `.d.ts`, los dos `.node.json` y los dos `.svg`). Si aparece
cualquier `.ts` de `nodes/` o `credentials/`, algun `.js.map`, o este mismo
`PUBLICAR.md`, hay que arreglar el campo `files` antes de seguir: una version
publicada en npm es **inmutable**.

Nada de esto pide `npm publish` en local. **No publicar desde la laptop**: un
paquete subido a mano no lleva procedencia y n8n no lo verifica.

---

## Paso 3. Dejar el repositorio publico listo

1. Confirmar que el repositorio es **publico** (Settings > General > al final,
   *Danger Zone*: tiene que decir *Change visibility to private*, no lo
   contrario).
2. Confirmar que contiene:
   - `integrations/n8n-nodes-threadlywdp/` con el paquete.
   - `.github/workflows/publicar-nodo-n8n.yml`.
   - `package-lock.json` versionado (el workflow corre `npm ci` y sin lockfile
     falla).
3. Confirmar que **no** contiene nada del monorepo: ni `src/`, ni
   `prisma/schema.prisma`, ni `.env`, ni `infra/`. Es un repositorio publico.
4. Confirmar que `dist/` **no** esta versionado (esta en `.gitignore`): lo
   compila el workflow, y un `dist/` viejo commiteado es exactamente el tipo de
   discrepancia que la procedencia existe para delatar.

---

## Paso 4. Crear la etiqueta

La version del `package.json` y la etiqueta tienen que coincidir; el workflow lo
comprueba y aborta si no. `npm version` hace las dos cosas de una: sube la
version, commitea y crea la etiqueta `vX.Y.Z`.

Para la **0.1.0**, que ya esta escrita en el `package.json`, la etiqueta se crea
a mano:

```bash
git tag v0.1.0
git push origin main --follow-tags
```

Para las versiones **siguientes**:

```bash
# 1. Anotar los cambios en CHANGELOG.md bajo una seccion nueva y commitear.
# 2. Subir la version (elegir una):
npm version patch    # 0.1.0 -> 0.1.1   correcciones
npm version minor    # 0.1.0 -> 0.2.0   operaciones o campos nuevos
npm version major    # 0.1.0 -> 1.0.0   cambios que rompen flujos existentes
# 3. Empujar commit y etiqueta juntos:
git push --follow-tags
```

Empujar la etiqueta es lo que dispara el workflow. Un push a `main` sin etiqueta
no publica nada.

---

## Paso 5. Mirar correr el workflow

En el repositorio publico, pestana **Actions** > *Publicar nodo n8n en npm*.
Los pasos, en orden, y que significa que falle cada uno:

| Paso | Si falla |
| --- | --- |
| Instalar dependencias de desarrollo | El `package-lock.json` no esta sincronizado con el `package.json`. Correr `npm install` en local y commitear el lockfile. |
| Comprobar que no hay dependencias de ejecucion | Alguien agrego una dependencia real. Un nodo verificado no puede tener ninguna: hay que sacarla. |
| Verificar tipos / Compilar | Error de TypeScript. Reproducible en local con `npm run lint`. |
| Comprobar que la etiqueta coincide con la version | La etiqueta dice una version y el `package.json` otra. Borrar la etiqueta (`git tag -d`, `git push --delete origin vX.Y.Z`), corregir y volver a etiquetar. |
| Publicar | Ver la tabla de errores del final. |

---

## Paso 6. Comprobar que la procedencia salio bien

Tres comprobaciones independientes. Vale la pena hacer las tres la primera vez.

**1. En la pagina del paquete en npm.** Abrir
<https://www.npmjs.com/package/n8n-nodes-threadlywdp>. En la barra lateral derecha
tiene que aparecer un bloque **Provenance** con el repositorio, el commit y el
workflow que lo construyeron. Si no aparece, el paquete se publico **sin**
procedencia y n8n no lo va a verificar.

**2. Desde la linea de comandos.**

```bash
npm view n8n-nodes-threadlywdp dist.attestations
```

Tiene que devolver un objeto con una URL de `registry.npmjs.org/-/npm/v1/attestations/...`
y `provenance` entre los tipos. Si devuelve vacio, no hay procedencia.

**3. Verificando la firma de verdad.** Esta es la unica que comprueba que la
atestacion es valida y no solo que existe:

```bash
npm audit signatures
```

Correrlo en una carpeta limpia donde se haya instalado el paquete:

```bash
mkdir /tmp/verificar-threadly && cd /tmp/verificar-threadly
npm init -y && npm install n8n-nodes-threadlywdp
npm audit signatures
```

Tiene que decir que las firmas y las atestaciones son validas.

**4. Prueba funcional.** Que el paquete este firmado no significa que el nodo
cargue. Instalarlo en un n8n real (**Settings > Community nodes**), abrir un
flujo nuevo y confirmar que:
- Los nodos **Threadly** y **Threadly Trigger** aparecen en el buscador con su
  icono.
- La credencial **Threadly API** aparece y el boton *Test* da verde contra un
  tenant real con una API key con scope `contacts:read`.

---

## Paso 7. Enviar el nodo a verificacion

Con el paquete publicado y con procedencia, el envio se hace desde el
[Creator Portal de n8n](https://creators.n8n.io). Antes de enviar conviene pasar
el escaner oficial, que es el mismo que corre n8n del lado suyo:

```bash
npx @n8n/scan-community-package n8n-nodes-threadlywdp
```

Tiene que decir que el paquete paso todas las comprobaciones. Corre contra la
version **ya publicada** en npm, no contra la carpeta local.

---

## Errores tipicos al publicar, y que significan

| Error | Causa | Solucion |
| --- | --- | --- |
| `EOTP` / `E401` | El `NPM_TOKEN` vencio, se revoco, o es un token clasico con 2FA obligatorio | Generar un Granular Access Token nuevo y actualizar el secret |
| `E403 Forbidden` | El nombre `n8n-nodes-threadlywdp` ya lo tomo otra cuenta, o el token no tiene permiso de escritura | Verificar la propiedad del nombre en npm y el alcance del token |
| `EPUBLISHCONFLICT` / `cannot publish over previously published version` | Esa version ya existe en npm | Subir la version y volver a etiquetar. Una version publicada no se puede reemplazar |
| `Provenance generation in GitHub Actions requires "write" access to the "id-token" permission` | Falta `id-token: write` | Ya esta en el workflow; si aparece, alguien lo borro |
| `package.json repository url does not match` (o la publicacion se rechaza al firmar) | El repositorio desde el que corre el workflow no es el de `repository.url` | Ver el Paso 0 |
| El workflow corre pero no publica nada | Se empujo el commit sin la etiqueta | `git push --follow-tags` |

---

## Lo que NO hay que hacer

- **No publicar desde la laptop** (`npm publish` a mano). Queda sin procedencia y
  n8n no lo verifica. Peor: como la version es inmutable, hay que quemar un
  numero de version para arreglarlo.
- **No usar `npm unpublish`** para corregir. npm solo lo permite dentro de las
  primeras 72 horas y deja el numero de version bloqueado para siempre. Lo
  correcto es publicar una version nueva.
- **No mover ni renombrar** `.github/workflows/publicar-nodo-n8n.yml` despues de
  configurar Trusted Publishers: la autorizacion esta atada al nombre del
  archivo y dejaria de publicar.
- **No hacer publico el monorepo** de Threadly para resolver el Paso 0.
