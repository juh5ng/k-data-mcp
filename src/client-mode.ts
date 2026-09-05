export function clientMode(privateKey: string | undefined) {
  return privateKey ? { canSpend: true, label: "paid" as const } : { canSpend: false, label: "free-preview" as const };
}
