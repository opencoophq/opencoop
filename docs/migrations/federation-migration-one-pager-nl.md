# OpenCoop Migratie One-Pager (Federatiebriefing)

*Voor Rescoop Vlaanderen / Rescoop Wallonië en lidcoöperaties*

---

## Doel

Een coöperatie veilig laten overstappen van spreadsheets of legacy-software naar OpenCoop, met minimale risico's, volledige datacontinuïteit en duidelijke verantwoordelijkheid.

## Wat wordt gemigreerd

- Coöperantenprofielen (particulieren, bedrijven, minderjarigen)
- Historiek van het aandelenregister (inschrijvingen, overdrachten, uitstappen)
- Project- en aandelenklassestructuur
- Dividendhistoriek en fiscaal relevante velden
- Kerndocumenten en communicatiemetadata (waar beschikbaar)

## Migratieprincipes

- **Geen black box**: mappingdocumentatie wordt vooraf gedeeld.
- **Eerst valideren**: totalen en aantallen worden gecontroleerd voor go-live.
- **Veilige cutover**: oude bestanden blijven beschikbaar tijdens verificatie.
- **Geen lock-in**: OpenCoop is AGPL-3.0 en exportvriendelijk.

## Proces in 4 stappen

### 1) Discovery (Week 1)
- Inventaris van bronnen (Excel-bestanden, exports, documentmappen)
- Mappingworkshop (OpenCoop-velden vs. legacy-velden)
- Risicoscan (duplicaten, ontbrekende IBAN, gedeelde e-mails, randgevallen)

### 2) Pilootimport (Week 2)
- Import in een stagingomgeving
- Kwaliteitscontroles:
  - aantal coöperanten
  - totaal aandelen per klasse
  - totalen van historische transacties
  - dividendtotalen (bruto/belasting/netto)
- Afwijkingsrapport delen en uitzonderingen oplossen

### 3) Finale migratie + cutover (Week 3)
- Legacy-updates bevriezen tijdens afgesproken cutovervenster
- Finale import uitvoeren
- Checklist voor bestuursgoedkeuring:
  - totalen stemmen overeen
  - steekproefcontrole uitgevoerd
  - portaaltoegang bevestigd
  - sleutel-documenten zichtbaar

### 4) Hypercare (Weken 4-6)
- Wekelijkse check-ins met bestuur
- Prioriteitsondersteuning voor datavragen
- Fijnregeling van configuratie en communicatietemplates

## Rollen en verantwoordelijkheden

| Partij | Verantwoordelijkheid |
|------|----------------------|
| Coöperatiebestuur | Bronbestanden aanleveren, dataregels bevestigen, validatie goedkeuren |
| OpenCoop-team | Mapping, importscripts, kwaliteitscontroles, go-live ondersteuning |
| Federatie (optioneel) | Pilootgroep coördineren en lessons learned delen tussen coöperaties |

## Typische timing

- **Kleine coöperatie (tot 500 coöperanten):** 2-3 weken
- **Middelgrote coöperatie (500-2.000 coöperanten):** 3-5 weken
- **Complexe historiek / meerdere legacy-bronnen:** 5+ weken

## Succescriteria

- 100% van coöperantenrecords overgezet
- Aandelentotalen komen overeen met legacybron bij cutover
- Dividendhistoriek gevalideerd voor afgesproken jaren
- Bestuur kan dagelijkse workflows uitvoeren zonder spreadsheets
- Leden krijgen self-service via portaal (transacties, dividenden, documenten)

## Veelgestelde zorgen (en beheersmaatregelen)

- **"Wat als de data inconsistent is?"**  
  We markeren afwijkingen in staging en lossen die op voor productie-import.
- **"Wat als we moeten terugdraaien?"**  
  Legacybestanden blijven onaangeroerd; cutover pas na bestuursgoedkeuring.
- **"Hoe zit het met privacy en controle?"**  
  Belgisch-coöperatieve datalogica, rolgebaseerde toegang en open-source transparantie.

## Volgende stap

Kies één pilootcoöperatie en plan een discoverygesprek van 60 minuten over migratie.
