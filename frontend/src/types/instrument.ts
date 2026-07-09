export interface InstrumentOut {
  id: number;
  serial_number: string;
  name: string | null;
  active: boolean;
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
