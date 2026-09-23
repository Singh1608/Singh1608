// Boards found by tracing employers from the aggregators back to their own
// careers pages (tools/trace_employers.mjs), then verified with the production
// adapters (tools/build_sources.mjs). Merged into SOURCES in _lib.js.
//
// How an entry got here:
//   1. NoFluffJobs, LinkedIn's guest search and justjoin.it named 875
//      employers hiring for consulting-shaped roles in Poland.
//   2. Each employer's own website was walked to its careers page, and the ATS
//      that page links to was recorded. The link came from the employer, not
//      from guessing a slug.
//   3. The board was read with the same adapter the nightly refresh uses, and
//      kept only if it returned roles in Poland.
//   4. Every entry whose identifier does not resemble the employer was checked
//      by hand. Two were dropped as recruitment-agency boards (Biovico's
//      "wilandt", tribe47's "talent47"); the rest are parent companies or
//      opaque Oracle hosts, labelled by who actually owns the board.
//
// Trailing comments are the verification counts on 23 Sep 2026: roles in
// Poland, and roles passing every feed filter that day. Boards with zero
// matching roles are kept on purpose — they have Poland openings in adjacent
// functions and the next posting may be his.
//
// Not included, and why:
//   - the same postings twice: HelloFresh's Phenom site (already read through
//     Greenhouse), State Street / U.S. Bank / Thermo Fisher on Phenom (their
//     Phenom jobs apply through the Workday boards below), a second Marsh
//     McLennan Workday site and a second Northmill career site
//   - internal career sites (Novartis "Internal_Careers_for_Acquired_…"),
//     which only existing employees can apply through
//   - eRecruiter, Avature, iCIMS and Taleo employers — no public listing
//     endpoint found yet; see tools/trace_employers.mjs output

export const DISCOVERED = {
  ashby: [
    { name: "CreatorIQ", slug: "creatoriq" }, // PL 4, matching 0
    { name: "Kraken", slug: "kraken.com" }, // PL 7, matching 0
    { name: "Neurons Lab", slug: "neurons-lab.com" }, // PL 9, matching 2
    { name: "Patrianna", slug: "patrianna" }, // PL 1, matching 0
  ],
  bamboohr: [
    { name: "Array Marketing", slug: "arraymarketing" }, // PL 3, matching 1
    { name: "Coople", slug: "coople" }, // PL 2, matching 0
    { name: "Meniga", slug: "meniga" }, // PL 6, matching 0
    { name: "Tickmill", slug: "tickmill" }, // PL 7, matching 0
  ],
  breezy: [
    { name: "Cronos Europa", slug: "cronoseuropa" }, // PL 19, matching 1
  ],
  cornerstone: [
    { name: "Bank Millennium", slug: "millenniumelearning", site: "2" }, // PL 181, matching 0
    { name: "Simon-Kucher", slug: "simon-kucher", site: "6" }, // PL 21, matching 1
  ],
  greenhouse: [
    { name: "Altman Solon", slug: "altmansolonuslp" }, // PL 2, matching 0
    { name: "Cognism", slug: "cognism" }, // PL 7, matching 0
    { name: "Iterative Health", slug: "iterativehealth" }, // PL 3, matching 0
    { name: "mthree", slug: "mthree" }, // PL 1, matching 0
    { name: "Scandit", slug: "scandit" }, // PL 3, matching 1
    { name: "Verifone", slug: "verifone" }, // PL 1, matching 0
  ],
  jobvite: [
    { name: "AliveCor", slug: "alivecor" }, // PL 1, matching 1
    { name: "Egnyte", slug: "egnyte" }, // PL 4, matching 1
  ],
  lever: [
    { name: "Adaptovate", slug: "adaptovate", eu: true }, // PL 1, matching 1
    { name: "SwingDev", slug: "swingdev" }, // PL 7, matching 0
    { name: "Viseven", slug: "viseven" }, // PL 11, matching 1
    { name: "XTB", slug: "xtb", eu: true }, // PL 29, matching 1
  ],
  oracle: [
    { name: "BNY", host: "eofe.fa.us2.oraclecloud.com", site: "BNY" }, // PL 20, matching 0
    { name: "DP World", host: "ehpv.fa.em2.oraclecloud.com", site: "CX_1" }, // PL 14, matching 0
    { name: "Euroclear", host: "don.fa.em2.oraclecloud.com", site: "CX_1003" }, // PL 5, matching 3
    { name: "Honeywell", host: "ibqbjb.fa.ocs.oraclecloud.com", site: "Honeywell" }, // PL 6, matching 2
    { name: "Nexi", host: "fa-ewwx-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1" }, // PL 2, matching 0
    { name: "Nokia", host: "fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com", site: "CX_1" }, // PL 6, matching 1
    { name: "Pearson", host: "hccz.fa.em3.oraclecloud.com", site: "CX_2" }, // PL 9, matching 1
  ],
  phenom: [
    { name: "Ardagh Group", host: "jobs.ardaghgroup.com", base: "https://jobs.ardaghgroup.com/global/en" }, // PL 9, matching 0
    { name: "Bureau Veritas", host: "jobs.bureauveritas.com", base: "https://jobs.bureauveritas.com/gb/en" }, // PL 3, matching 1
    { name: "GSK", host: "jobs.gsk.com", base: "https://jobs.gsk.com/gb/en" }, // PL 31, matching 1
    { name: "Kuehne+Nagel", host: "jobs.kuehne-nagel.com", base: "https://jobs.kuehne-nagel.com/global/en" }, // PL 22, matching 1
    { name: "Philips", host: "www.careers.philips.com", base: "https://www.careers.philips.com/na/en" }, // PL 20, matching 1
    { name: "Roche", host: "careers.roche.com", base: "https://careers.roche.com/global/en" }, // PL 79, matching 6
    { name: "Zimmer Biomet", host: "careers.zimmerbiomet.com", base: "https://careers.zimmerbiomet.com/us/en" }, // PL 15, matching 0
  ],
  pinpoint: [
    { name: "Infor", slug: "infor" }, // PL 8, matching 1
  ],
  recruitee: [
    { name: "Addepto", slug: "addepto" }, // PL 12, matching 1
    { name: "Huuuge Games", slug: "huuuge" }, // PL 7, matching 0
    { name: "MGID", slug: "mgid" }, // PL 6, matching 0
    { name: "SkyCell", slug: "skycellag" }, // PL 5, matching 3
  ],
  smartrecruiters: [
    { name: "Bosch", slug: "BoschGroup" }, // PL 2, matching 0
    { name: "EcoVadis", slug: "ecovadis" }, // PL 6, matching 1
    { name: "Salomon (Amer Sports)", slug: "Salomon" }, // PL 3, matching 0
  ],
  successfactors: [
    { name: "Alstom", host: "jobsearch.alstom.com" }, // PL 24, matching 1
    { name: "GFT", host: "jobs.gft.com" }, // PL 160, matching 46
    { name: "Westinghouse Electric", host: "careers.westinghousenuclear.com" }, // PL 54, matching 1
  ],
  teamtailor: [
    { name: "Avenga", host: "career.avenga.com" }, // PL 12, matching 1
    { name: "Evotym", host: "careers.evotym.com" }, // PL 14, matching 0
    { name: "IQM Quantum Computers", slug: "iqm" }, // PL 2, matching 0
    { name: "LumApps", host: "job.lumapps.com" }, // PL 5, matching 0
    { name: "Northmill Bank", slug: "northmill" }, // PL 1, matching 0
    { name: "Reef Assistants", slug: "reefassistants-careers" }, // PL 1, matching 0
    { name: "Spyrosoft", host: "careers.spyro-soft.com" }, // PL 87, matching 8
    { name: "TheWhiteam", host: "careers.twtspain.com" }, // PL 10, matching 0
    { name: "Wavin", host: "careers.wavin.com" }, // PL 5, matching 0
  ],
  traffit: [
    { name: "Altkom Software", slug: "asc" }, // PL 52, matching 3
    { name: "ambiscale", slug: "ambiscale" }, // PL 7, matching 2
    { name: "apreel", slug: "apreel" }, // PL 6, matching 1
    { name: "Emerge Soft", slug: "emergesoft" }, // PL 3, matching 0
    { name: "Go On Board", slug: "goonboard" }, // PL 1, matching 0
    { name: "IT Solution Factor", slug: "itsf" }, // PL 2, matching 0
    { name: "Jit Team", slug: "jit" }, // PL 88, matching 2
    { name: "Kuchnia Vikinga", slug: "kuchniavikinga" }, // PL 17, matching 0
    { name: "Mindbox", slug: "mindboxgroup" }, // PL 96, matching 8
    { name: "Neontri", slug: "neontri" }, // PL 32, matching 4
    { name: "Polcode", slug: "polcode" }, // PL 2, matching 0
    { name: "Satisfly", slug: "satisfly" }, // PL 1, matching 0
    { name: "SeniorApp", slug: "seniorapp" }, // PL 21, matching 0
    { name: "Soflab Technology", slug: "soflab" }, // PL 18, matching 1
    { name: "Transition Technologies MS", slug: "ttms" }, // PL 10, matching 3
    { name: "VikingCo", slug: "mobilevikings" }, // PL 2, matching 0
    { name: "Xopero Software", slug: "xoperosoftware" }, // PL 1, matching 0
  ],
  workable: [
    { name: "AI Acquisition", slug: "ai-acquisition" }, // PL 11, matching 0
    { name: "Frontiers", slug: "frontiersmedia" }, // PL 12, matching 1
    { name: "MMDSmart", slug: "mmdsmart-ltd" }, // PL 7, matching 0
    { name: "Netguru", slug: "netguru" }, // PL 36, matching 5
  ],
  workday: [
    { name: "Alcon", host: "alcon.wd5.myworkdayjobs.com", tenant: "alcon", site: "careers_alcon" }, // PL 15, matching 0
    { name: "Amadeus", host: "amadeus.wd502.myworkdayjobs.com", tenant: "amadeus", site: "jobs" }, // PL 5, matching 2
    { name: "BeOne Medicines", host: "beigene.wd5.myworkdayjobs.com", tenant: "beigene", site: "BeiGene" }, // PL 32, matching 4
    { name: "Bristol Myers Squibb", host: "bristolmyerssquibb.wd5.myworkdayjobs.com", tenant: "bristolmyerssquibb", site: "BMS" }, // PL 34, matching 0
    { name: "C.H. Robinson", host: "chrobinson.wd5.myworkdayjobs.com", tenant: "chrobinson", site: "CHRobinson" }, // PL 8, matching 0
    { name: "Carrier", host: "carrier.wd5.myworkdayjobs.com", tenant: "carrier", site: "jobs" }, // PL 11, matching 1
    { name: "Citi", host: "citi.wd5.myworkdayjobs.com", tenant: "citi", site: "2" }, // PL 125, matching 7
    { name: "Concentrix", host: "cnx.wd1.myworkdayjobs.com", tenant: "cnx", site: "external_global" }, // PL 4, matching 0
    { name: "Core Laboratories", host: "corelab.wd12.myworkdayjobs.com", tenant: "corelab", site: "CLB" }, // PL 3, matching 0
    { name: "Covetrus", host: "covetrus.wd5.myworkdayjobs.com", tenant: "covetrus", site: "CovetrusCareers" }, // PL 1, matching 0
    { name: "dentsu", host: "dentsuaegis.wd3.myworkdayjobs.com", tenant: "dentsuaegis", site: "DAN_GLOBAL" }, // PL 20, matching 0
    { name: "Dover", host: "dover.wd103.myworkdayjobs.com", tenant: "dover", site: "Dover" }, // PL 5, matching 0
    { name: "DS Smith", host: "dssmith.wd3.myworkdayjobs.com", tenant: "dssmith", site: "careers" }, // PL 11, matching 0
    { name: "DXC Technology", host: "dxctechnology.wd1.myworkdayjobs.com", tenant: "dxctechnology", site: "DXCJobs" }, // PL 28, matching 1
    { name: "ESAB", host: "esab.wd5.myworkdayjobs.com", tenant: "esab", site: "esabcareers" }, // PL 3, matching 0
    { name: "Flex (Anord Mardix)", host: "flextronics.wd1.myworkdayjobs.com", tenant: "flextronics", site: "Anord_Mardix_Careers" }, // PL 7, matching 0
    { name: "Fresenius Medical Care", host: "freseniusmedicalcare.wd3.myworkdayjobs.com", tenant: "freseniusmedicalcare", site: "fme" }, // PL 75, matching 1
    { name: "Galderma", host: "galderma.wd3.myworkdayjobs.com", tenant: "galderma", site: "External" }, // PL 17, matching 4
    { name: "GE Vernova", host: "gevernova.wd5.myworkdayjobs.com", tenant: "gevernova", site: "Vernova_ExternalSite" }, // PL 12, matching 0
    { name: "Global Payments (TSYS)", host: "tsys.wd1.myworkdayjobs.com", tenant: "tsys", site: "TSYS" }, // PL 19, matching 0
    { name: "Guidewire Software", host: "wd5.myworkdaysite.com", tenant: "guidewire", site: "external", recruiting: true }, // PL 5, matching 0
    { name: "Hitachi", host: "hitachi.wd1.myworkdayjobs.com", tenant: "hitachi", site: "hitachi" }, // PL 196, matching 10
    { name: "IQVIA", host: "iqvia.wd1.myworkdayjobs.com", tenant: "iqvia", site: "IQVIA" }, // PL 54, matching 4
    { name: "Jabil", host: "jabil.wd5.myworkdayjobs.com", tenant: "jabil", site: "Jabil_Careers" }, // PL 3, matching 0
    { name: "JLL", host: "jll.wd1.myworkdayjobs.com", tenant: "jll", site: "jllcareers" }, // PL 60, matching 6
    { name: "Johnson Controls", host: "jci.wd5.myworkdayjobs.com", tenant: "jci", site: "JCI" }, // PL 9, matching 1
    { name: "Linklaters", host: "linklaters.wd3.myworkdayjobs.com", tenant: "linklaters", site: "Linklaters" }, // PL 8, matching 1
    { name: "LSEG", host: "lseg.wd3.myworkdayjobs.com", tenant: "lseg", site: "Careers" }, // PL 29, matching 1
    { name: "Marsh McLennan (Oliver Wyman)", host: "mmc.wd1.myworkdayjobs.com", tenant: "mmc", site: "MMC" }, // PL 59, matching 7
    { name: "Mondelēz International", host: "wd3.myworkdaysite.com", tenant: "mdlz", site: "External", recruiting: true }, // PL 180, matching 0
    { name: "Motorola Solutions", host: "motorolasolutions.wd5.myworkdayjobs.com", tenant: "motorolasolutions", site: "Careers" }, // PL 61, matching 0
    { name: "MSD", host: "msd.wd5.myworkdayjobs.com", tenant: "msd", site: "SearchJobs" }, // PL 4, matching 0
    { name: "Nasdaq", host: "nasdaq.wd1.myworkdayjobs.com", tenant: "nasdaq", site: "Global_External_Site" }, // PL 8, matching 3
    { name: "PHINIA", host: "phinia.wd5.myworkdayjobs.com", tenant: "phinia", site: "PHINIA_Careers" }, // PL 5, matching 0
    { name: "Polpharma", host: "polpharma.wd3.myworkdayjobs.com", tenant: "polpharma", site: "Polpharma" }, // PL 133, matching 2
    { name: "QIAGEN", host: "qiagen.wd502.myworkdayjobs.com", tenant: "qiagen", site: "QIAGEN" }, // PL 20, matching 1
    { name: "Relativity", host: "kcura.wd1.myworkdayjobs.com", tenant: "kcura", site: "External_Career_Site" }, // PL 12, matching 0
    { name: "Remitly", host: "remitly.wd5.myworkdayjobs.com", tenant: "remitly", site: "Remitly_Careers" }, // PL 6, matching 0
    { name: "Rockwool", host: "rockwoolgroup.wd3.myworkdayjobs.com", tenant: "rockwoolgroup", site: "ROCKWOOL" }, // PL 170, matching 30
    { name: "Sabre", host: "sabre.wd1.myworkdayjobs.com", tenant: "sabre", site: "SabreJobs" }, // PL 28, matching 0
    { name: "SimCorp", host: "simcorp.wd3.myworkdayjobs.com", tenant: "simcorp", site: "SimCorp_Jobs" }, // PL 53, matching 9
    { name: "Smith+Nephew", host: "smithnephew.wd5.myworkdayjobs.com", tenant: "smithnephew", site: "External" }, // PL 17, matching 2
    { name: "State Street", host: "statestreet.wd1.myworkdayjobs.com", tenant: "statestreet", site: "Global" }, // PL 117, matching 25
    { name: "The Coca-Cola Company", host: "coke.wd1.myworkdayjobs.com", tenant: "coke", site: "coca-cola-careers" }, // PL 2, matching 0
    { name: "Thermo Fisher Scientific", host: "thermofisher.wd5.myworkdayjobs.com", tenant: "thermofisher", site: "ThermoFisherCareers" }, // PL 21, matching 1
    { name: "Thomson Reuters", host: "thomsonreuters.wd5.myworkdayjobs.com", tenant: "thomsonreuters", site: "External_Career_Site" }, // PL 12, matching 1
    { name: "TransPerfect", host: "transperfect.wd5.myworkdayjobs.com", tenant: "transperfect", site: "transperfect" }, // PL 4, matching 0
    { name: "U.S. Bank", host: "usbank.wd1.myworkdayjobs.com", tenant: "usbank", site: "US_Bank_Careers" }, // PL 26, matching 3
    { name: "Workday", host: "workday.wd5.myworkdayjobs.com", tenant: "workday", site: "Workday" }, // PL 11, matching 6
    { name: "Worldwide Clinical Trials", host: "worldwide.wd1.myworkdayjobs.com", tenant: "worldwide", site: "External" }, // PL 4, matching 0
    { name: "Xylem", host: "xylem.wd5.myworkdayjobs.com", tenant: "xylem", site: "xylem-careers" }, // PL 12, matching 0
    { name: "Zendesk", host: "zendesk.wd1.myworkdayjobs.com", tenant: "zendesk", site: "zendesk" }, // PL 5, matching 0
  ],
};
