Button — the primary action element (nav CTAs, form submits, card actions). Use `primary` once per view for the main action; `secondary`/`ghost` for everything else.

```jsx
<Button variant="primary" size="md">Регистрация</Button>
<Button variant="secondary">Вход</Button>
<Button variant="ghost" size="sm">Научете повече</Button>
```

Variants: `primary` (solid gold, `--text-on-accent`), `secondary` (outlined, neutral), `ghost` (borderless, neutral — use in dense toolbars/nav). Sizes: `sm` / `md` (default) / `lg`. `disabled` dims to 50% opacity and blocks pointer events.
