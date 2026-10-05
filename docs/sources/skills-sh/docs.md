## Documentation

Learn how to discover, install, and use skills with your AI agents.

The `skills` CLI that powers this leaderboard is open source at [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills).

## What are skills?

Skills are reusable capabilities for AI agents. They provide procedural knowledge that helps agents accomplish specific tasks more effectively. Think of them as plugins or extensions that enhance what your AI agent can do.

## Getting started

To install a skill, use the `skills` CLI:

```
npx skills add vercel-labs/agent-skills
```

This will install the skill and make it available to your AI agent.

## Browse skills

Visit the [homepage](https://skills.sh/) to browse the skills leaderboard and discover new capabilities for your agents.

## How skills are ranked

The skills leaderboard ranks skills based on anonymous telemetry data collected from the `skills` CLI. When users install skills, aggregated usage data helps surface the most popular and useful skills in the ecosystem.

This telemetry is completely anonymous and only tracks which skills are being installed—no personal information or usage patterns are collected.

## Skill packs

Packs let you bundle public and private skills into one shareable install command. Learn how to create and manage packs in the [packs documentation](https://skills.sh/docs/packs).

## Badge

Add an install count badge to your README:

```
[![skills.sh](https://skills.sh/b/owner/repo)](https://skills.sh/owner/repo)
```

Replace `owner/repo` with your GitHub source. For example:

```
[![skills.sh](https://skills.sh/b/anthropics/skills)](https://skills.sh/anthropics/skills)
```

## How are you securing skills?

There are routine security audits that assess skills and their contents for malicious content. To report security issues, please visit [security.vercel.com](https://security.vercel.com/).

We do our best to maintain a safe ecosystem, but we cannot guarantee the quality or security of every skill listed on skills.sh. We encourage you to review skills before installing and use your own judgment.