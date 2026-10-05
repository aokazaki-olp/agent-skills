## Packs

Share a collection of skills with one install command.

## What are packs?

Packs are unlisted collections of skills. A pack can combine public skills from skills.sh, private skills from files, folders, or zip archives, and skills from GitHub repositories you can access.

Packs can contain more than one skill from a folder, archive, or repository: every valid `SKILL.md` is included.

## Create a pack

Sign in with Vercel to own and manage packs.

1. Open [Create pack](https://skills.sh/packs/create) and sign in with Vercel.
2. Add a name and, optionally, a short description.
3. Choose the Vercel team to share the pack with.
4. Add any combination of public skills, private files, and skills from GitHub repositories you connect.
5. Create the pack and copy the install command.

## Install a pack

Install a pack with the skills CLI. No authentication required:

```
npx skills add https://skills.sh/p/<pack-id>
```

## Update a pack

When a pack's skills change, pull the latest versions of your installed skills with:

```
npx skills update
```

Only skills that changed are re-downloaded. Update a single skill with `npx skills update <skill>`.

New installs always fetch the current contents, so anyone who runs the install command after an update gets the latest skills automatically.

## Manage packs

The [Packs](https://skills.sh/packs) page groups your packs by the Vercel team they belong to.

Open a pack's page to manage it: creators can delete a pack there, which disables its install link.

## Sharing and privacy

Packs are unlisted, not access-controlled: anyone with the pack URL can view and install it.

Do not include secrets or credentials in a pack. Delete a pack when its install link should stop working.

## File requirements

Each included skill needs a `SKILL.md` with `name` and `description` frontmatter. The builder skips invalid skill files and omits binary files or individual files larger than 2 MB.