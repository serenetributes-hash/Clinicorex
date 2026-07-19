export type Role = "ADMIN" | "RECEPTIONIST" | "NURSE" | "DOCTOR" | "LAB_TECH" | "PHARMACIST" | "CASHIER" | "WARD_NURSE" | "THEATRE_NURSE";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  gender: string;
  phone?: string;
  nationalId?: string;
  insuranceProvider?: string;
  insuranceNo?: string;
  encounters?: Encounter[];
}

export interface TriageRecord {
  bp?: string;
  temp?: number;
  pulse?: number;
  spo2?: number;
  weight?: number;
  priority: "NORMAL" | "URGENT" | "EMERGENCY";
  notes?: string;
}

export interface LabOrder {
  id: string;
  testName: string;
  price: string;
  status: "PENDING" | "COMPLETED";
  result?: string;
}

export interface Prescription {
  id: string;
  itemId: string;
  quantity: number;
  dispensed: boolean;
  item: { id: string; name: string; unit: string; quantity: number; unitPrice: string };
}

export interface BillingItem {
  id: string;
  description: string;
  amount: string;
  category?: string;
}

export interface ConsultationNote {
  id: string;
  doctorId?: string;
  diagnosis?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface NursingNote {
  id: string;
  note: string;
  recordedById?: string;
  recordedAt: string;
}

export interface Admission {
  id: string;
  admittedAt: string;
  dischargedAt?: string | null;
  admittingDiagnosis?: string | null;
  bed?: { bedNumber: string; ward?: { name: string } };
  nursingNotes?: NursingNote[];
}

export interface Encounter {
  id: string;
  patientId: string;
  status: string;
  type?: string;
  registeredAt?: string;
  chiefComplaint?: string;
  patient?: Patient;
  triage?: TriageRecord;
  consultations?: ConsultationNote[];
  labOrders?: LabOrder[];
  prescriptions?: Prescription[];
  billingItems?: BillingItem[];
  payment?: any;
  admission?: Admission | null;
}

export interface QueueEntry {
  id: string;
  encounterId: string;
  department: string;
  status: "WAITING" | "CLAIMED" | "COMPLETED" | "CANCELLED";
  priority: "NORMAL" | "URGENT" | "EMERGENCY";
  createdAt: string;
  claimedAt?: string;
  encounter: Encounter;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitPrice: string;
}
