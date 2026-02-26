# Dev Guest Mode

## How to run

### 1) Normal local dev (default behavior)

- Do not set `NEXT_PUBLIC_DEV_GUEST_MODE` in `.env.local` (or set it to any value except `1`).
- Start the app:

```bash
npm run dev
```

The app runs on `http://localhost:3001`.

### 2) Local dev guest mode (no auth redirect + no 500 on `/`)

Add this line to `.env.local`:

```env
NEXT_PUBLIC_DEV_GUEST_MODE=1
```

Then start (or restart) the app:

```bash
npm run dev
```

Open `http://localhost:3001`.

## Important note

After changing `.env.local`, you must restart the dev server for env changes to take effect.

## Production safety

Guest mode is active only when:

`process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_GUEST_MODE === '1'`

So production behavior is unchanged.
