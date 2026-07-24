// Prices are enforced server-side from this catalog — never trust an amount
// sent by the client for anything that ends up on a patient's bill.
// Amounts are in KES.

export const CONSULTATION_FEE = 500;

export const LAB_TEST_CATALOG: Record<string, { name: string; price: number }> = {
  cbc: { name: "Full Blood Count", price: 800 },
  malaria: { name: "Malaria Parasite Test", price: 300 },
  widal: { name: "Widal Test (Typhoid)", price: 400 },
  urinalysis: { name: "Urinalysis", price: 300 },
  glucose: { name: "Blood Glucose", price: 250 },
  hiv: { name: "HIV Rapid Test", price: 200 },
  xray: { name: "X-Ray Imaging", price: 1500 },
  ultrasound: { name: "Ultrasound Scan", price: 2000 },
  hepb: { name: "Hepatitis B Screen", price: 500 },
  pregnancy: { name: "Pregnancy Test", price: 250 },
};
