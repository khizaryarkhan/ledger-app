// The Customers directory was merged into the unified Accounts page. This route
// renders the same component, which opens on the "Customers" segment (billing
// lens) when reached via /admin/customers. One directory, one implementation.
export { default } from "../accounts/page";
