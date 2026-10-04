// Curated dermatology journals. `abbr` is the NLM abbreviation used for Europe PMC queries;
// `issn` (when present) is preferred because it matches every article in the journal.
window.JOURNALS = [
  // Leading clinical journals
  { name: 'Journal of the American Academy of Dermatology', abbr: 'J Am Acad Dermatol', issn: '0190-9622', publisher: 'Elsevier', group: 'Leading clinical', top: true },
  { name: 'JAMA Dermatology', abbr: 'JAMA Dermatol', issn: '2168-6068', publisher: 'AMA', group: 'Leading clinical', top: true },
  { name: 'British Journal of Dermatology', abbr: 'Br J Dermatol', issn: '0007-0963', publisher: 'Oxford', group: 'Leading clinical', top: true },
  { name: 'Journal of the European Academy of Dermatology and Venereology', abbr: 'J Eur Acad Dermatol Venereol', issn: '0926-9959', publisher: 'Wiley', group: 'Leading clinical', top: true },
  { name: 'American Journal of Clinical Dermatology', abbr: 'Am J Clin Dermatol', issn: '1175-0561', publisher: 'Springer', group: 'Leading clinical', top: true },
  { name: 'Clinical and Experimental Dermatology', abbr: 'Clin Exp Dermatol', issn: '0307-6938', publisher: 'Oxford', group: 'Leading clinical' },
  { name: 'International Journal of Dermatology', abbr: 'Int J Dermatol', issn: '0011-9059', publisher: 'Wiley', group: 'Leading clinical' },
  { name: 'Dermatology', abbr: 'Dermatology', issn: '1018-8665', publisher: 'Karger', group: 'Leading clinical' },
  { name: 'Journal of Dermatological Treatment', abbr: 'J Dermatolog Treat', issn: '0954-6634', publisher: 'Taylor & Francis', group: 'Leading clinical' },
  { name: 'Dermatologic Therapy', abbr: 'Dermatol Ther', publisher: 'Wiley', group: 'Leading clinical' },
  { name: 'Clinics in Dermatology', abbr: 'Clin Dermatol', issn: '0738-081X', publisher: 'Elsevier', group: 'Leading clinical' },
  { name: 'Dermatologic Clinics', abbr: 'Dermatol Clin', publisher: 'Elsevier', group: 'Leading clinical' },

  // Research
  { name: 'Journal of Investigative Dermatology', abbr: 'J Invest Dermatol', issn: '0022-202X', publisher: 'Elsevier', group: 'Research', top: true },
  { name: 'Experimental Dermatology', abbr: 'Exp Dermatol', issn: '0906-6705', publisher: 'Wiley', group: 'Research' },
  { name: 'Journal of Dermatological Science', abbr: 'J Dermatol Sci', publisher: 'Elsevier', group: 'Research' },
  { name: 'Skin Research and Technology', abbr: 'Skin Res Technol', publisher: 'Wiley', group: 'Research' },
  { name: 'Wound Repair and Regeneration', abbr: 'Wound Repair Regen', publisher: 'Wiley', group: 'Research' },

  // Open access
  { name: 'JAAD International', abbr: 'JAAD Int', issn: '2666-3287', publisher: 'Elsevier', group: 'Open access', oa: true },
  { name: 'JAAD Case Reports', abbr: 'JAAD Case Rep', publisher: 'Elsevier', group: 'Open access', oa: true },
  { name: 'Acta Dermato-Venereologica', abbr: 'Acta Derm Venereol', publisher: 'Medical Journals Sweden', group: 'Open access', oa: true },
  { name: 'Dermatology and Therapy', abbr: 'Dermatol Ther (Heidelb)', issn: '2190-9172', publisher: 'Springer', group: 'Open access', oa: true },
  { name: 'Clinical, Cosmetic and Investigational Dermatology', abbr: 'Clin Cosmet Investig Dermatol', issn: '1178-7015', publisher: 'Dove', group: 'Open access', oa: true },
  { name: 'Annals of Dermatology', abbr: 'Ann Dermatol', issn: '1013-9087', publisher: 'Korean Dermatological Assoc.', group: 'Open access', oa: true },
  { name: 'Skin Health and Disease', abbr: 'Skin Health Dis', publisher: 'Oxford', group: 'Open access', oa: true },
  { name: "International Journal of Women's Dermatology", abbr: 'Int J Womens Dermatol', issn: '2352-6475', publisher: 'LWW', group: 'Open access', oa: true },
  { name: 'Dermatology Practical & Conceptual', abbr: 'Dermatol Pract Concept', issn: '2160-9381', publisher: 'Mattioli', group: 'Open access', oa: true },
  { name: 'JID Innovations', abbr: 'JID Innov', issn: '2667-0267', publisher: 'Elsevier', group: 'Open access', oa: true },
  { name: 'JMIR Dermatology', abbr: 'JMIR Dermatol', issn: '2562-0959', publisher: 'JMIR', group: 'Open access', oa: true },
  { name: 'Dermatology Online Journal', abbr: 'Dermatol Online J', issn: '1087-2108', publisher: 'UC Davis', group: 'Open access', oa: true },

  // India & regional
  { name: 'Indian Journal of Dermatology, Venereology and Leprology', abbr: 'Indian J Dermatol Venereol Leprol', issn: '0378-6323', publisher: 'Scientific Scholar', group: 'India & regional', oa: true },
  { name: 'Indian Journal of Dermatology', abbr: 'Indian J Dermatol', issn: '0019-5154', publisher: 'Medknow', group: 'India & regional', oa: true },
  { name: 'Indian Dermatology Online Journal', abbr: 'Indian Dermatol Online J', issn: '2229-5178', publisher: 'Medknow', group: 'India & regional', oa: true },
  { name: 'The Journal of Dermatology', abbr: 'J Dermatol', issn: '0385-2407', publisher: 'Wiley', group: 'India & regional' },
  { name: 'Australasian Journal of Dermatology', abbr: 'Australas J Dermatol', issn: '0004-8380', publisher: 'Wiley', group: 'India & regional' },
  { name: 'Journal der Deutschen Dermatologischen Gesellschaft', abbr: 'J Dtsch Dermatol Ges', issn: '1610-0379', publisher: 'Wiley', group: 'India & regional' },
  { name: 'European Journal of Dermatology', abbr: 'Eur J Dermatol', issn: '1167-1122', publisher: 'John Libbey', group: 'India & regional' },
  { name: 'Anais Brasileiros de Dermatologia', abbr: 'An Bras Dermatol', publisher: 'Elsevier', group: 'India & regional', oa: true },
  { name: 'Actas Dermo-Sifiliográficas', abbr: 'Actas Dermosifiliogr', publisher: 'Elsevier', group: 'India & regional' },
  { name: 'Italian Journal of Dermatology and Venereology', abbr: 'Ital J Dermatol Venerol', issn: '2784-8450', publisher: 'Minerva', group: 'India & regional' },

  // Subspecialty
  { name: 'Pediatric Dermatology', abbr: 'Pediatr Dermatol', issn: '0736-8046', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Dermatologic Surgery', abbr: 'Dermatol Surg', publisher: 'LWW', group: 'Subspecialty' },
  { name: 'Journal of Cosmetic Dermatology', abbr: 'J Cosmet Dermatol', issn: '1473-2130', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Journal of Drugs in Dermatology', abbr: 'J Drugs Dermatol', issn: '1545-9616', publisher: 'SanovaWorks', group: 'Subspecialty' },
  { name: 'Lasers in Surgery and Medicine', abbr: 'Lasers Surg Med', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Contact Dermatitis', abbr: 'Contact Dermatitis', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Dermatitis', abbr: 'Dermatitis', publisher: 'Mary Ann Liebert', group: 'Subspecialty' },
  { name: 'Photodermatology, Photoimmunology & Photomedicine', abbr: 'Photodermatol Photoimmunol Photomed', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Skin Appendage Disorders', abbr: 'Skin Appendage Disord', publisher: 'Karger', group: 'Subspecialty' },
  { name: 'Journal of Cutaneous Pathology', abbr: 'J Cutan Pathol', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'American Journal of Dermatopathology', abbr: 'Am J Dermatopathol', publisher: 'LWW', group: 'Subspecialty' },
  { name: 'Melanoma Research', abbr: 'Melanoma Res', publisher: 'LWW', group: 'Subspecialty' },
  { name: 'Mycoses', abbr: 'Mycoses', publisher: 'Wiley', group: 'Subspecialty' },
  { name: 'Leprosy Review', abbr: 'Lepr Rev', publisher: 'Lepra', group: 'Subspecialty' },
];

window.JOURNAL_GROUPS = ['Leading clinical', 'Research', 'Open access', 'India & regional', 'Subspecialty'];

window.TOPICS = [
  'Psoriasis', 'Atopic dermatitis', 'Acne vulgaris', 'Vitiligo', 'Melasma', 'Alopecia areata',
  'Hidradenitis suppurativa', 'Chronic urticaria', 'Melanoma', 'Basal cell carcinoma',
  'Pemphigus', 'Lichen planus', 'Rosacea', 'Dermatophytosis', 'Leprosy', 'Scabies',
  'Androgenetic alopecia', 'Seborrheic dermatitis', 'Cutaneous lupus', 'Drug eruptions',
];

window.EXAMPLES = [
  'Does dupilumab improve atopic dermatitis in children?',
  'JAK inhibitors for alopecia areata',
  'Is isotretinoin associated with depression?',
  'Tranexamic acid for melasma',
  'Itraconazole dosing in recalcitrant dermatophytosis',
  'Biologics vs methotrexate in psoriasis',
];
