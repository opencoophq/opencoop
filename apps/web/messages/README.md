# Translation Conventions

## Enum-to-Label Mappings

Role enums (`SYSTEM_ADMIN`, `COOP_ADMIN`, `SHAREHOLDER`) must never be displayed raw in the UI. Always use translated labels:

```tsx
t(`system.users.roles.${user.role}`)
```

The same pattern applies to other enums (shareholder types, transaction statuses, etc.) — use the corresponding translation keys under their respective namespaces.

## Adding Translations

All user-facing strings must have translations in all four locale files: `en.json`, `nl.json`, `fr.json` and `de.json`. When adding a new enum value:

1. Add the key under the appropriate `roles`/`types`/`statuses` object in both files
2. Use the enum value as the key (e.g., `"COOP_ADMIN": "Administrator"`)
3. Use the translation function with template literals in components: `` t(`namespace.${enumValue}`) ``
