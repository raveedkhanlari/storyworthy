# Future Items

Deferred features and enhancements, not part of the current freemium Phase 1.

## Stories

- **Delete story.** Currently a story is permanent once started (one story per user, freemium). The "Delete Vote" link is disabled for a vote that has an associated story. Add a way to delete a story (and re-enable deleting its vote) in a future tier.

## Security / Infrastructure

- **Move JWT secret to a managed secret store.** The JWT secret is currently passed via `sam deploy --parameter-overrides` on every deploy, which lands it in shell history. Move it to AWS Secrets Manager (or SSM Parameter Store SecureString) and have the Lambda read it at runtime, so it never appears in a command again.
