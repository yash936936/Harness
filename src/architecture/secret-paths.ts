const SECRET_PATTERNS = [
  /(^|\/)\.env[^/]*$/i,
  /(^|\/)[^/]*\.env$/i,
  /(^|\/)\.(aws|ssh|azure|docker|kube|gnupg)(?:\/|$)/i,
  /(^|\/)\.config\/(gcloud|gh)(?:\/|$)/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(?!\.pub)[^/]*$/i,
  /(^|\/)\.(npmrc|netrc|pgpass|git-credentials|pypirc|terraformrc)$/i,
  /(^|\/)\.cargo\/credentials(?:\.toml)?$/i,
  /(^|\/)\.terraform\.d\/credentials\.tfrc\.json$/i,
  /(^|\/)kubeconfig$/i,
  /(^|\/)[^/]*\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)credentials(?:\.json)?$/i,
  /(^|\/)service[-_]account[^/]*\.json$/i,
  /(^|\/)application_default_credentials\.json$/i,
  /(^|\/)secrets?\.(ya?ml|json|toml)$/i,
  /(^|\/)etc\/shadow$/i,
  /(^|\/)proc\/(self|[0-9]+)\/environ$/i,
]

/** Likely-secret paths are refused by all model-facing file and workspace transfer tools. */
export function isSecretPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/').toLowerCase()
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized))
}
