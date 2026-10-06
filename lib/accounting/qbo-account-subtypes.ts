/**
 * QuickBooks Online's own AccountType -> AccountSubType ("Detail type")
 * taxonomy, keyed by the same spaced AccountType strings QBO returns on the
 * wire (and that `accounts.type` is stored as verbatim — see
 * lib/qbo-ap-sync.ts). Codes are the real AccountSubType wire values (e.g.
 * "SuppliesMaterialsCogs"), cross-checked against Intuit's documented enum
 * and against every distinct (type, subtype) pair actually present on this
 * app's QBO-synced accounts — a handful of codes below (CostOfSales,
 * AmortizationExpense, PayrollWageExpenses, ...) only appear in real synced
 * data, not in Intuit's current reference table, and are kept for that
 * reason: an older or since-retired AccountSubType an existing QBO company
 * still carries must still resolve to a real label here.
 *
 * This is the single source for the Detail type dropdown AND for rendering
 * a stored subtype code as a friendly label — a native account's subtype and
 * a QBO-synced account's subtype must be the same vocabulary, or nothing
 * that groups/filters by subtype can treat them alike.
 */

export interface QboSubtype {
  code: string;
  label: string;
}

export const QBO_ACCOUNT_SUBTYPES: Record<string, QboSubtype[]> = {
  "Bank": [
    { code: "CashOnHand", label: "Cash on hand" },
    { code: "Checking", label: "Chequing" },
    { code: "MoneyMarket", label: "Money market" },
    { code: "RentsHeldInTrust", label: "Rents held in trust" },
    { code: "Savings", label: "Savings" },
    { code: "TrustAccounts", label: "Trust account" },
  ],
  "Accounts Receivable": [
    { code: "AccountsReceivable", label: "Accounts Receivable (A/R)" },
  ],
  "Other Current Asset": [
    { code: "AllowanceForBadDebts", label: "Allowance for bad debts" },
    { code: "DevelopmentCosts", label: "Development costs" },
    { code: "EmployeeCashAdvances", label: "Employee cash advances" },
    { code: "Inventory", label: "Inventory" },
    { code: "Investment_MortgageRealEstateLoans", label: "Investments — mortgage/real estate loans" },
    { code: "Investment_Other", label: "Investments — other" },
    { code: "Investment_TaxExemptSecurities", label: "Investments — tax-exempt securities" },
    { code: "Investment_USGovernmentObligations", label: "Investments — US government obligations" },
    { code: "LoansToOfficers", label: "Loans to officers" },
    { code: "LoansToOthers", label: "Loans to others" },
    { code: "LoansToStockholders", label: "Loans to stockholders" },
    { code: "OtherCurrentAssets", label: "Other current assets" },
    { code: "PrepaidExpenses", label: "Prepaid expenses" },
    { code: "Retainage", label: "Retainage" },
    { code: "UndepositedFunds", label: "Undeposited funds" },
  ],
  "Fixed Asset": [
    { code: "AccumulatedAmortization", label: "Accumulated amortisation" },
    { code: "AccumulatedDepletion", label: "Accumulated depletion" },
    { code: "AccumulatedDepreciation", label: "Accumulated depreciation" },
    { code: "Buildings", label: "Buildings" },
    { code: "DepletableAssets", label: "Depletable assets" },
    { code: "FurnitureAndFixtures", label: "Furniture & fixtures" },
    { code: "IntangibleAssets", label: "Intangible assets" },
    { code: "Land", label: "Land" },
    { code: "LeaseholdImprovements", label: "Leasehold improvements" },
    { code: "MachineryAndEquipment", label: "Machinery & equipment" },
    { code: "NonCurrentAssets", label: "Non-current assets" },
    { code: "OtherFixedAssets", label: "Other fixed assets" },
    { code: "Vehicles", label: "Vehicles" },
  ],
  "Other Asset": [
    { code: "AccumulatedAmortizationOfOtherAssets", label: "Accumulated amortisation of other assets" },
    { code: "AssetsHeldForSale", label: "Assets held for sale" },
    { code: "DeferredTax", label: "Deferred tax" },
    { code: "Goodwill", label: "Goodwill" },
    { code: "IntangibleAssetsOther", label: "Other intangible assets" },
    { code: "LeaseBuyout", label: "Lease buyout" },
    { code: "Licenses", label: "Licences" },
    { code: "LongTermInvestments", label: "Long-term investments" },
    { code: "OrganizationalCosts", label: "Organisational costs" },
    { code: "OtherLongTermAssets", label: "Other long-term assets" },
    { code: "SecurityDeposits", label: "Security deposits" },
  ],
  "Accounts Payable": [
    { code: "AccountsPayable", label: "Accounts Payable (A/P)" },
  ],
  "Credit Card": [
    { code: "CreditCard", label: "Credit card" },
    { code: "LineOfCredit", label: "Line of credit" },
  ],
  "Other Current Liability": [
    { code: "DirectDepositPayable", label: "Direct deposit payable" },
    { code: "FederalIncomeTaxPayable", label: "Federal income tax payable" },
    { code: "GlobalTaxPayable", label: "Tax payable" },
    { code: "GlobalTaxSuspense", label: "Tax suspense" },
    { code: "InsurancePayable", label: "Insurance payable" },
    { code: "LoanPayable", label: "Loan payable" },
    { code: "OtherCurrentLiabilities", label: "Other current liabilities" },
    { code: "PayrollClearing", label: "Payroll clearing" },
    { code: "PayrollTaxPayable", label: "Payroll tax payable" },
    { code: "PrepaidExpensesPayable", label: "Prepaid expenses payable" },
    { code: "RentsInTrustLiability", label: "Rents in trust (liability)" },
    { code: "SalesTaxPayable", label: "Sales tax / VAT / GST payable" },
    { code: "StateLocalIncomeTaxPayable", label: "State/local income tax payable" },
    { code: "TrustAccountsLiabilities", label: "Trust accounts (liability)" },
  ],
  "Long Term Liability": [
    { code: "NotesPayable", label: "Notes payable" },
    { code: "OtherLongTermLiabilities", label: "Other long-term liabilities" },
    { code: "ShareholderNotesPayable", label: "Shareholder notes payable" },
  ],
  "Equity": [
    { code: "AccumulatedAdjustment", label: "Accumulated adjustment" },
    { code: "CommonStock", label: "Common stock" },
    { code: "OpeningBalanceEquity", label: "Opening balance equity" },
    { code: "OwnersEquity", label: "Owner's equity" },
    { code: "PaidInCapitalOrSurplus", label: "Paid-in capital or surplus" },
    { code: "PartnerContributions", label: "Partner contributions" },
    { code: "PartnerDistributions", label: "Partner distributions" },
    { code: "PartnersEquity", label: "Partners' equity" },
    { code: "PreferredStock", label: "Preferred stock" },
    { code: "RetainedEarnings", label: "Retained earnings" },
    { code: "TreasuryStock", label: "Treasury stock" },
  ],
  "Income": [
    { code: "DiscountsRefundsGiven", label: "Discounts/refunds given" },
    { code: "NonProfitIncome", label: "Non-profit income" },
    { code: "OtherPrimaryIncome", label: "Other primary income" },
    { code: "SalesOfProductIncome", label: "Sales of product income" },
    { code: "ServiceFeeIncome", label: "Service/fee income" },
    { code: "UnappliedCashPaymentIncome", label: "Unapplied cash payment income" },
  ],
  "Cost of Goods Sold": [
    { code: "CostOfLaborCos", label: "Cost of labour" },
    { code: "CostOfSales", label: "Cost of sales" },
    { code: "EquipmentRentalCos", label: "Equipment rental" },
    { code: "OtherCostsOfServiceCos", label: "Other costs of services" },
    { code: "ShippingFreightDeliveryCos", label: "Shipping & freight delivery" },
    { code: "SuppliesMaterialsCogs", label: "Supplies & materials" },
  ],
  "Expense": [
    { code: "AdvertisingPromotional", label: "Advertising & promotional" },
    { code: "AmortizationExpense", label: "Amortisation expense" },
    { code: "Auto", label: "Auto" },
    { code: "BadDebts", label: "Bad debts" },
    { code: "BankCharges", label: "Bank charges" },
    { code: "CharitableContributions", label: "Charitable contributions" },
    { code: "CommissionsAndFees", label: "Commissions & fees" },
    { code: "CostOfLabor", label: "Cost of labour" },
    { code: "DuesSubscriptions", label: "Dues & subscriptions" },
    { code: "Entertainment", label: "Entertainment" },
    { code: "EntertainmentMeals", label: "Entertainment meals" },
    { code: "EquipmentRental", label: "Equipment rental" },
    { code: "FinanceCosts", label: "Finance costs" },
    { code: "GlobalTaxExpense", label: "Tax expense" },
    { code: "IncomeTaxExpense", label: "Income tax expense" },
    { code: "Insurance", label: "Insurance" },
    { code: "InterestPaid", label: "Interest paid" },
    { code: "LegalProfessionalFees", label: "Legal & professional fees" },
    { code: "LossOnDiscontinuedOperationsNetOfTax", label: "Loss on discontinued operations (net of tax)" },
    { code: "ManagementCompensation", label: "Management compensation" },
    { code: "OfficeGeneralAdministrativeExpenses", label: "Office/general & administrative expenses" },
    { code: "OtherBusinessExpenses", label: "Other business expenses" },
    { code: "OtherMiscellaneousServiceCost", label: "Other miscellaneous service cost" },
    { code: "OtherSellingExpenses", label: "Other selling expenses" },
    { code: "PayrollExpenses", label: "Payroll expenses" },
    { code: "PayrollWageExpenses", label: "Payroll & wage expenses" },
    { code: "PromotionalMeals", label: "Promotional meals" },
    { code: "RentOrLeaseOfBuildings", label: "Rent or lease of buildings" },
    { code: "RepairMaintenance", label: "Repairs & maintenance" },
    { code: "ShippingAndDeliveryExpense", label: "Shipping and delivery expense" },
    { code: "ShippingFreightDelivery", label: "Shipping & freight delivery" },
    { code: "SuppliesMaterials", label: "Supplies & materials" },
    { code: "TaxesPaid", label: "Taxes paid" },
    { code: "Travel", label: "Travel" },
    { code: "TravelExpensesGeneralAndAdminExpenses", label: "Travel expenses (G&A)" },
    { code: "TravelExpensesSellingExpense", label: "Travel expenses (selling)" },
    { code: "TravelMeals", label: "Travel meals" },
    { code: "UnappliedCashBillPaymentExpense", label: "Unapplied cash bill payment expense" },
    { code: "Utilities", label: "Utilities" },
  ],
  "Other Income": [
    { code: "DividendIncome", label: "Dividend income" },
    { code: "InterestEarned", label: "Interest earned" },
    { code: "OtherInvestmentIncome", label: "Other investment income" },
    { code: "OtherMiscellaneousIncome", label: "Other miscellaneous income" },
    { code: "TaxExemptInterest", label: "Tax-exempt interest" },
  ],
  "Other Expense": [
    { code: "Amortization", label: "Amortisation" },
    { code: "Depreciation", label: "Depreciation" },
    { code: "ExchangeGainOrLoss", label: "Exchange gain or loss" },
    { code: "OtherMiscellaneousExpense", label: "Other miscellaneous expense" },
    { code: "PenaltiesSettlements", label: "Penalties & settlements" },
  ],
};

// Insert a space before each internal capital/underscore run so an
// unrecognised code (a future QBO AccountSubType this list hasn't caught up
// with yet) still renders as readable text instead of raw PascalCase.
function prettify(code: string): string {
  return code.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function subtypeLabel(type: string | null | undefined, subtype: string | null | undefined): string | null {
  if (!subtype) return null;
  const known = (type ? QBO_ACCOUNT_SUBTYPES[type] : undefined)?.find(s => s.code === subtype);
  if (known) return known.label;
  // Type didn't match (or wasn't passed) — search every group before falling back.
  for (const group of Object.values(QBO_ACCOUNT_SUBTYPES)) {
    const hit = group.find(s => s.code === subtype);
    if (hit) return hit.label;
  }
  return prettify(subtype);
}
