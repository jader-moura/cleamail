/**
 * Fixed pools the scenarios draw from.
 *
 * Every name, company and domain here is invented, and every domain is reserved by RFC 2606 or in
 * the `.example` TLD, which is what makes "no real email data in the repository" a property a test
 * can check rather than a promise a reviewer has to take on trust.
 */

export type Person = {
  readonly name: string;
  readonly first: string;
  /** Local part of their address. */
  readonly slug: string;
};

export const PEOPLE: readonly Person[] = [
  { name: "Ana Ribeiro", first: "Ana", slug: "ana.ribeiro" },
  { name: "Tom Becker", first: "Tom", slug: "tom.becker" },
  { name: "Priya Nair", first: "Priya", slug: "priya.nair" },
  { name: "Luc Moreau", first: "Luc", slug: "luc.moreau" },
  { name: "Sofia Alvarez", first: "Sofia", slug: "sofia.alvarez" },
  { name: "Kenji Watanabe", first: "Kenji", slug: "kenji.watanabe" },
  { name: "Hannah Olsen", first: "Hannah", slug: "hannah.olsen" },
  { name: "Omar Haddad", first: "Omar", slug: "omar.haddad" },
  { name: "Grace Mbeki", first: "Grace", slug: "grace.mbeki" },
  { name: "Pawel Nowak", first: "Pawel", slug: "pawel.nowak" },
  { name: "Mei Lin", first: "Mei", slug: "mei.lin" },
  { name: "Daniel Fischer", first: "Daniel", slug: "daniel.fischer" },
  { name: "Ines Costa", first: "Ines", slug: "ines.costa" },
  { name: "Samir Patel", first: "Samir", slug: "samir.patel" },
];

export type Company = {
  readonly name: string;
  readonly domain: string;
};

export const COMPANIES: readonly Company[] = [
  { name: "Northwind Freight", domain: "northwind.example" },
  { name: "Lumen Health", domain: "lumenhealth.example" },
  { name: "Harborline", domain: "harborline.example" },
  { name: "Mapleshift", domain: "mapleshift.example" },
  { name: "Orbit Labs", domain: "orbitlabs.example" },
  { name: "Quietwater Books", domain: "quietwater.example" },
  { name: "Ferrovia Rail", domain: "ferrovia.example" },
  { name: "Brightfold", domain: "brightfold.example" },
  { name: "Cedarpoint Bank", domain: "cedarpoint.example" },
  { name: "Tideline Gear", domain: "tideline.example" },
  { name: "Vantage Legal", domain: "vantagelegal.example" },
  { name: "Solstice Energy", domain: "solstice.example" },
  { name: "Kettle and Crumb", domain: "kettlecrumb.example" },
  { name: "Mirador Travel", domain: "mirador.example" },
];

export const AMOUNTS: readonly string[] = [
  "18.40",
  "42.00",
  "87.65",
  "129.99",
  "214.50",
  "386.10",
  "1,240.00",
  "2,975.30",
  "64.20",
  "9.99",
  "508.75",
];

export const ORDERS: readonly string[] = [
  "A-10457",
  "B-88321",
  "ORD-55910",
  "7741-22",
  "INV-20418",
  "TKT-3390",
  "C-60284",
  "REF-91746",
  "SO-13205",
];

export const CITIES: readonly string[] = [
  "Porto",
  "Leeds",
  "Toronto",
  "Osaka",
  "Rotterdam",
  "Austin",
  "Valencia",
  "Tallinn",
  "Cork",
];

export const PROJECTS: readonly string[] = [
  "Atlas",
  "Harbour",
  "Kestrel",
  "Lantern",
  "Meridian",
  "Pinewood",
  "Quartz",
  "Sandpiper",
];

export const DAYS: readonly string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const TIMES: readonly string[] = ["09:00", "10:30", "11:15", "14:00", "15:45", "16:30"];

export const NUMBERS: readonly string[] = ["2", "3", "4", "5", "7", "9", "12", "18"];
