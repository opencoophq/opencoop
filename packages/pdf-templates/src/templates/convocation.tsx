import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

const BLUE = '#1e40af';
const BORDER_COLOR = '#d1d5db';

const styles = StyleSheet.create({
  page: {
    padding: 50,
    paddingBottom: 80,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTextBlock: {
    flex: 1,
  },
  coopName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  coopMeta: {
    fontSize: 9,
    color: '#4b5563',
    lineHeight: 1.4,
  },
  logo: {
    width: 70,
    height: 70,
    objectFit: 'contain',
  },
  divider: {
    borderBottom: `1.5 solid ${BLUE}`,
    marginTop: 10,
    marginBottom: 18,
  },
  subjectBlock: {
    marginBottom: 18,
  },
  subjectLabel: {
    fontSize: 9,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  subjectTitle: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 6,
  },
  meetingMetaRow: {
    fontSize: 10,
    color: '#111827',
    marginBottom: 2,
  },
  meetingMetaLabel: {
    fontFamily: 'Helvetica-Bold',
  },
  salutation: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 11,
  },
  body: {
    fontSize: 10,
    lineHeight: 1.5,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginTop: 6,
    marginBottom: 8,
    borderBottom: `1 solid ${BORDER_COLOR}`,
    paddingBottom: 3,
  },
  agendaItem: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  agendaNumber: {
    width: 24,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
  agendaContent: {
    flex: 1,
  },
  agendaTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  agendaDescription: {
    fontSize: 9,
    color: '#4b5563',
    lineHeight: 1.4,
    marginTop: 2,
  },
  noticeBlock: {
    marginTop: 16,
    padding: 10,
    backgroundColor: '#f3f4f6',
    border: `1 solid ${BORDER_COLOR}`,
    fontSize: 9,
    lineHeight: 1.5,
    color: '#374151',
  },
  closing: {
    marginTop: 20,
    fontSize: 10,
    lineHeight: 1.5,
  },
  signatureLine: {
    marginTop: 30,
    borderTop: '1 solid #374151',
    width: 200,
    paddingTop: 4,
    fontSize: 9,
    color: '#4b5563',
  },
});

export interface ConvocationProps {
  coop: { name: string; address: string; companyId: string; logoUrl?: string };
  shareholder: { firstName: string; lastName: string; address?: string };
  meeting: {
    title: string;
    scheduledAt: Date;
    location: string;
    agendaItems: { order: number; title: string; description?: string | null }[];
  };
  language: 'nl' | 'en' | 'fr' | 'de';
}

const LABELS = {
  nl: {
    subject: 'Oproeping voor de Algemene Vergadering',
    dateLabel: 'Datum en uur',
    locationLabel: 'Locatie',
    dear: (name: string) => `Geachte heer/mevrouw ${name},`,
    invite:
      'Wij hebben het genoegen u uit te nodigen voor de Algemene Vergadering van onze coöperatieve vennootschap, met volgende agenda:',
    agenda: 'Agenda',
    rightsTitle: 'Rechten van de vennoot',
    rights:
      'Elke vennoot heeft het recht aan de vergadering deel te nemen, er het woord te voeren en zijn stem uit te brengen. Een vennoot kan zich laten vertegenwoordigen door een andere vennoot middels een schriftelijke volmacht. De agenda en begeleidende documenten zijn raadpleegbaar via uw persoonlijk shareholder-portaal.',
    closing: 'Wij kijken uit naar uw aanwezigheid.',
    board: 'Namens de raad van bestuur',
    companyIdLabel: 'Ondernemingsnummer',
  },
  en: {
    subject: 'Notice of General Meeting',
    dateLabel: 'Date and time',
    locationLabel: 'Location',
    dear: (name: string) => `Dear ${name},`,
    invite:
      'We are pleased to invite you to the General Meeting of our cooperative, with the following agenda:',
    agenda: 'Agenda',
    rightsTitle: 'Shareholder rights',
    rights:
      'Each shareholder has the right to attend the meeting, to speak and to cast their vote. A shareholder may appoint another shareholder as proxy by written power of attorney. The agenda and supporting documents are available via your personal shareholder portal.',
    closing: 'We look forward to your attendance.',
    board: 'On behalf of the board of directors',
    companyIdLabel: 'Company number',
  },
  fr: {
    subject: "Convocation à l'Assemblée Générale",
    dateLabel: 'Date et heure',
    locationLabel: 'Lieu',
    dear: (name: string) => `Cher/Chère ${name},`,
    invite:
      "Nous avons le plaisir de vous inviter à l'Assemblée Générale de notre société coopérative, avec l'ordre du jour suivant :",
    agenda: 'Ordre du jour',
    rightsTitle: "Droits de l'actionnaire",
    rights:
      "Chaque actionnaire a le droit d'assister à l'assemblée, d'y prendre la parole et d'y voter. Un actionnaire peut se faire représenter par un autre actionnaire au moyen d'une procuration écrite. L'ordre du jour et les documents d'accompagnement sont consultables via votre portail personnel.",
    closing: 'Nous nous réjouissons de votre présence.',
    board: 'Au nom du conseil d\'administration',
    companyIdLabel: "Numéro d'entreprise",
  },
  de: {
    subject: 'Einladung zur Generalversammlung',
    dateLabel: 'Datum und Uhrzeit',
    locationLabel: 'Ort',
    dear: (name: string) => `Sehr geehrte(r) ${name},`,
    invite:
      'Wir freuen uns, Sie zur Generalversammlung unserer Genossenschaft mit folgender Tagesordnung einladen zu dürfen:',
    agenda: 'Tagesordnung',
    rightsTitle: 'Rechte der Anteilseigner',
    rights:
      'Jeder Anteilseigner hat das Recht, an der Versammlung teilzunehmen, das Wort zu ergreifen und seine Stimme abzugeben. Ein Anteilseigner kann sich durch einen anderen Anteilseigner mittels schriftlicher Vollmacht vertreten lassen. Die Tagesordnung und zugehörige Dokumente sind über Ihr persönliches Aktionärsportal einsehbar.',
    closing: 'Wir freuen uns auf Ihre Teilnahme.',
    board: 'Im Namen des Vorstands',
    companyIdLabel: 'Unternehmensnummer',
  },
};

const LOCALE_MAP: Record<ConvocationProps['language'], string> = {
  nl: 'nl-BE',
  en: 'en-US',
  fr: 'fr-BE',
  de: 'de-DE',
};

function formatDateTime(date: Date, language: ConvocationProps['language']): string {
  const locale = LOCALE_MAP[language];
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

export const ConvocationPdf: React.FC<ConvocationProps> = ({
  coop,
  shareholder,
  meeting,
  language,
}) => {
  const t = LABELS[language] ?? LABELS.nl;
  const fullName = `${shareholder.firstName} ${shareholder.lastName}`.trim();
  const when = formatDateTime(meeting.scheduledAt, language);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.coopName}>{coop.name}</Text>
            {coop.address ? <Text style={styles.coopMeta}>{coop.address}</Text> : null}
            {coop.companyId ? (
              <Text style={styles.coopMeta}>
                {t.companyIdLabel}: {coop.companyId}
              </Text>
            ) : null}
          </View>
          {coop.logoUrl ? <Image style={styles.logo} src={coop.logoUrl} /> : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.subjectBlock}>
          <Text style={styles.subjectLabel}>{t.subject}</Text>
          <Text style={styles.subjectTitle}>{meeting.title}</Text>
          <Text style={styles.meetingMetaRow}>
            <Text style={styles.meetingMetaLabel}>{t.dateLabel}: </Text>
            {when}
          </Text>
          <Text style={styles.meetingMetaRow}>
            <Text style={styles.meetingMetaLabel}>{t.locationLabel}: </Text>
            {meeting.location}
          </Text>
        </View>

        <Text style={styles.salutation}>{t.dear(fullName || '—')}</Text>
        <Text style={styles.body}>{t.invite}</Text>

        <Text style={styles.sectionTitle}>{t.agenda}</Text>
        {meeting.agendaItems.map((item, idx) => (
          <View key={idx} style={styles.agendaItem}>
            <Text style={styles.agendaNumber}>{item.order}.</Text>
            <View style={styles.agendaContent}>
              <Text style={styles.agendaTitle}>{item.title}</Text>
              {item.description ? (
                <Text style={styles.agendaDescription}>{item.description}</Text>
              ) : null}
            </View>
          </View>
        ))}

        <View style={styles.noticeBlock}>
          <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>{t.rightsTitle}</Text>
          <Text>{t.rights}</Text>
        </View>

        <Text style={styles.closing}>{t.closing}</Text>
        <View style={styles.signatureLine}>
          <Text>{t.board}</Text>
        </View>
      </Page>
    </Document>
  );
};
