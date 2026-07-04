export interface Quote {
  price: number;      // last price
  prevClose: number;  // previous session close
  ts: number;         // last update (ms)
}

export interface Profile {
  logo: string;
  name: string;
}

export interface Section {
  id: string;
  name: string | null; // null = unnamed default section (no header rendered)
  symbols: string[];
}

export interface Tab {
  id: string;
  name: string;
  sections: Section[];
}
