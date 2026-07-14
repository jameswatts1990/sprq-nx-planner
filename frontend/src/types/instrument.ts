export interface InstrumentOut {
  id: number;
  serial_number: string;
  name: string | null;
  active: boolean;
  is_locked: boolean;
  locked_until: string | null; // ISO datetime
}

export interface InstrumentCreate {
  serial_number: string;
  name?: string | null;
  active?: boolean;
}

export interface InstrumentUpdate {
  name?: string | null;
  active?: boolean | null;
}
