export function contactField(contact, field) {
  const value = field === "firstName" ? String(contact.name || "").trim().split(/\s+/)[0]
    : ["name", "email", "phone"].includes(field) ? contact[field] : "";
  return String(value ?? "");
}
