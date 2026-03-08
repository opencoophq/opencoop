'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency } from '@opencoop/shared';
import { DatePicker } from '@/components/ui/date-picker';
import { EpcQrCode } from '@/components/epc-qr-code';
import { Gift, UserPlus, LogIn } from 'lucide-react';
import { EmailFirstLogin } from '@/components/auth/email-first-login';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { resolveLogoUrl } from '@/lib/api';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
  secondaryColor?: string;
  logoUrl?: string | null;
  bankName?: string;
  bankIban?: string;
  bankBic?: string;
  termsUrl?: string;
  shareClasses: Array<{
    id: string;
    name: string;
    code: string;
    pricePerShare: number;
    minShares: number;
    maxShares?: number;
  }>;
  projects: Array<{
    id: string;
    name: string;
  }>;
}

interface ExistingShareholder {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  email?: string;
  phone?: string;
  street?: string;
  number?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

const registrationSchema = z.object({
  shareholderId: z.string().optional(),
  beneficiaryType: z.enum(['self', 'family', 'company', 'gift']),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  birthDate: z.string().optional(),
  companyName: z.string().optional(),
  companyId: z.string().optional(),
  vatNumber: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  street: z.string().min(1),
  number: z.string().min(1),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  shareClassId: z.string().min(1),
  projectId: z.string().optional(),
  quantity: z.number().min(1),
  paymentMethod: z.enum(['BANK_TRANSFER', 'MOLLIE', 'STRIPE']),
  acceptTerms: z.literal(true),
});

type RegistrationForm = z.infer<typeof registrationSchema>;

export function CoopRegisterContent({
  coopSlug,
  channelSlug,
}: {
  coopSlug: string;
  channelSlug: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const preselectedClass = searchParams.get('class');
  const preselectedProject = searchParams.get('project');
  const preselectedShareholderId = searchParams.get('shareholderId');

  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [selectedShareholder, setSelectedShareholder] = useState<ExistingShareholder | null>(null);
  const [allShareholders, setAllShareholders] = useState<ExistingShareholder[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegisteringNew, setIsRegisteringNew] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [result, setResult] = useState<{
    registrationId: string;
    ogmCode?: string;
    giftCode?: string;
  } | null>(null);

  // Determine if user has existing shareholders (short flow) or is new (long flow)
  const hasExistingShareholders = allShareholders.length > 0 && !isRegisteringNew;

  // Step labels depend on whether user is logged in
  // Logged in: Details → Order → Payment (3 steps)
  // Not logged in: Welcome → Details → Order → Payment (4 steps)
  const stepsForLoggedIn = [
    t('registration.steps.details'),
    t('registration.steps.order'),
    t('registration.steps.payment'),
  ];
  const stepsForNewUser = [
    t('registration.steps.welcome'),
    t('registration.steps.details'),
    t('registration.steps.order'),
    t('registration.steps.payment'),
  ];
  const steps = isLoggedIn ? stepsForLoggedIn : stepsForNewUser;
  const totalSteps = steps.length;

  // Map logical step names to step numbers
  const STEP = isLoggedIn
    ? { DETAILS: 1, ORDER: 2, PAYMENT: 3 }
    : { WELCOME: 1, DETAILS: 2, ORDER: 3, PAYMENT: 4 };

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      beneficiaryType: 'self',
      paymentMethod: 'BANK_TRANSFER',
      quantity: 1,
      country: 'Belgium',
    },
  });

  const watchBeneficiaryType = form.watch('beneficiaryType');
  const watchShareClassId = form.watch('shareClassId');
  const watchQuantity = form.watch('quantity');

  const selectedShareClass = coop?.shareClasses.find(
    (sc) => sc.id === watchShareClassId
  );
  const totalAmount = selectedShareClass
    ? selectedShareClass.pricePerShare * watchQuantity
    : 0;

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch coop info
        const coopResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/channels/${channelSlug}/public-info`
        );
        if (!coopResponse.ok) {
          throw new Error('Failed to fetch coop info');
        }
        const coopData = await coopResponse.json();
        setCoop(coopData);

        // Pre-select share class if provided
        if (preselectedClass) {
          const sc = coopData.shareClasses.find(
            (s: { code: string }) => s.code === preselectedClass
          );
          if (sc) {
            form.setValue('shareClassId', sc.id);
          }
        }

        // Pre-select project if provided
        if (preselectedProject) {
          form.setValue('projectId', preselectedProject);
        }

        // Check if user is logged in and fetch their shareholders
        const token = localStorage.getItem('accessToken');
        if (token) {
          try {
            const meResponse = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL}/auth/me`,
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (meResponse.ok) {
              const meData = await meResponse.json();
              setIsLoggedIn(true);

              // Filter shareholders for this coop and flatten the address JSON
              const shareholdersForCoop: ExistingShareholder[] = (meData.shareholders || [])
                .filter((s: { coop: { id: string } }) => s.coop.id === coopData.id)
                .map((s: {
                  id: string;
                  type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
                  firstName?: string;
                  lastName?: string;
                  birthDate?: string;
                  companyName?: string;
                  companyId?: string;
                  vatNumber?: string;
                  email?: string;
                  phone?: string;
                  address?: { street?: string; number?: string; postalCode?: string; city?: string; country?: string } | null;
                }) => ({
                  id: s.id,
                  type: s.type,
                  firstName: s.firstName,
                  lastName: s.lastName,
                  birthDate: s.birthDate,
                  companyName: s.companyName,
                  companyId: s.companyId,
                  vatNumber: s.vatNumber,
                  email: s.email,
                  phone: s.phone,
                  street: s.address?.street,
                  number: s.address?.number,
                  postalCode: s.address?.postalCode,
                  city: s.address?.city,
                  country: s.address?.country,
                }));
              setAllShareholders(shareholdersForCoop);

              // If shareholderId provided, pre-select that shareholder
              if (preselectedShareholderId && shareholdersForCoop.length > 0) {
                const preselected = shareholdersForCoop.find(
                  (s: ExistingShareholder) => s.id === preselectedShareholderId
                );
                if (preselected) {
                  setSelectedShareholder(preselected);
                  prefillFormWithShareholder(preselected);
                }
              } else if (shareholdersForCoop.length > 0) {
                // Default to first shareholder
                setSelectedShareholder(shareholdersForCoop[0]);
                prefillFormWithShareholder(shareholdersForCoop[0]);
              } else if (meData.email) {
                // Logged in but no shareholders in this coop — pre-fill email
                form.setValue('email', meData.email);
              }
            } else {
              // Token is invalid/expired — clean up
              localStorage.removeItem('accessToken');
              localStorage.removeItem('user');
            }
          } catch {
            // User not logged in or error fetching - continue as new user
          }
        }
      } catch (error) {
        console.error('Failed to fetch coop:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [coopSlug, channelSlug, preselectedClass, preselectedProject, preselectedShareholderId, form]);

  // Read OAuth prefill params from URL (after redirect back from Google/Apple)
  useEffect(() => {
    if (searchParams.get('prefill') === '1') {
      const email = searchParams.get('email');
      const firstName = searchParams.get('firstName');
      const lastName = searchParams.get('lastName');
      if (email) form.setValue('email', email);
      if (firstName) form.setValue('firstName', firstName);
      if (lastName) form.setValue('lastName', lastName);
      // Clean prefill params from URL without triggering navigation
      window.history.replaceState({}, '', pathname);
    }
  }, [searchParams, pathname, form]);

  // Helper function to pre-fill form with shareholder data
  const prefillFormWithShareholder = (shareholder: ExistingShareholder) => {
    form.setValue('shareholderId', shareholder.id);
    const typeMap: Record<string, 'self' | 'family' | 'company'> = { INDIVIDUAL: 'self', MINOR: 'family', COMPANY: 'company' };
    form.setValue('beneficiaryType', typeMap[shareholder.type] || 'self');
    if (shareholder.firstName) form.setValue('firstName', shareholder.firstName);
    if (shareholder.lastName) form.setValue('lastName', shareholder.lastName);
    if (shareholder.birthDate) form.setValue('birthDate', shareholder.birthDate.split('T')[0]);
    if (shareholder.companyName) form.setValue('companyName', shareholder.companyName);
    if (shareholder.companyId) form.setValue('companyId', shareholder.companyId);
    if (shareholder.vatNumber) form.setValue('vatNumber', shareholder.vatNumber);
    if (shareholder.email) form.setValue('email', shareholder.email);
    if (shareholder.phone) form.setValue('phone', shareholder.phone);
    if (shareholder.street) form.setValue('street', shareholder.street);
    if (shareholder.number) form.setValue('number', shareholder.number);
    if (shareholder.postalCode) form.setValue('postalCode', shareholder.postalCode);
    if (shareholder.city) form.setValue('city', shareholder.city);
    if (shareholder.country) form.setValue('country', shareholder.country);
  };

  // Get display name for a shareholder
  const getShareholderDisplayName = (shareholder: ExistingShareholder) => {
    if (shareholder.type === 'COMPANY') {
      return shareholder.companyName || 'Company';
    }
    return `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim() || 'Shareholder';
  };

  // Handle shareholder selection change
  const handleShareholderChange = (shareholderId: string) => {
    if (shareholderId === 'new') {
      setIsRegisteringNew(true);
      setSelectedShareholder(null);
      // Preserve preselected share class and project across reset
      const { shareClassId, projectId } = form.getValues();
      form.reset({
        beneficiaryType: 'self',
        paymentMethod: 'BANK_TRANSFER',
        quantity: 1,
        country: 'Belgium',
        shareClassId,
        projectId,
      });
    } else {
      const shareholder = allShareholders.find(s => s.id === shareholderId);
      if (shareholder) {
        setSelectedShareholder(shareholder);
        prefillFormWithShareholder(shareholder);
      }
    }
  };

  // Handle successful login from the welcome step's inline login form
  const handleLoginSuccess = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token || !coop) return;

    try {
      const meResponse = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/me`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (meResponse.ok) {
        const meData = await meResponse.json();
        setIsLoggedIn(true);

        const shareholdersForCoop: ExistingShareholder[] = (meData.shareholders || [])
          .filter((s: { coop: { id: string } }) => s.coop.id === coop.id)
          .map((s: {
            id: string;
            type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
            firstName?: string;
            lastName?: string;
            birthDate?: string;
            companyName?: string;
            companyId?: string;
            vatNumber?: string;
            email?: string;
            phone?: string;
            address?: { street?: string; number?: string; postalCode?: string; city?: string; country?: string } | null;
          }) => ({
            id: s.id,
            type: s.type,
            firstName: s.firstName,
            lastName: s.lastName,
            birthDate: s.birthDate,
            companyName: s.companyName,
            companyId: s.companyId,
            vatNumber: s.vatNumber,
            email: s.email,
            phone: s.phone,
            street: s.address?.street,
            number: s.address?.number,
            postalCode: s.address?.postalCode,
            city: s.address?.city,
            country: s.address?.country,
          }));
        setAllShareholders(shareholdersForCoop);

        if (shareholdersForCoop.length > 0) {
          setSelectedShareholder(shareholdersForCoop[0]);
          prefillFormWithShareholder(shareholdersForCoop[0]);
        } else if (meData.email) {
          form.setValue('email', meData.email);
        }

        // Jump to Details step (step 1 for logged-in users, since isLoggedIn is now true)
        setStep(1);
      }
    } catch {
      setIsLoggedIn(true);
      setStep(1);
    }
  };

  // Validate step 1 fields before navigating to step 2
  const handleStep1Next = async () => {
    if (hasExistingShareholders) {
      // Existing shareholder selected — no form validation needed
      setStep(STEP.ORDER);
      return;
    }

    // Validate required fields based on beneficiary type
    let fieldsToValidate: (keyof RegistrationForm)[];
    if (watchBeneficiaryType === 'gift') {
      fieldsToValidate = ['email'];
    } else if (watchBeneficiaryType === 'company') {
      fieldsToValidate = ['companyName', 'email', 'street', 'number', 'postalCode', 'city', 'country'];
    } else {
      fieldsToValidate = ['firstName', 'lastName', 'email', 'street', 'number', 'postalCode', 'city', 'country'];
    }

    const result = await form.trigger(fieldsToValidate);
    if (result) {
      setStep(STEP.ORDER);
    }
  };

  const onSubmit = async () => {
    const valid = await form.trigger(['shareClassId', 'quantity', 'acceptTerms']);
    if (!valid) return;

    setSubmitting(true);

    try {
      const values = form.getValues();

      // Build payload based on whether we have an existing shareholder
      let payload: Record<string, unknown>;
      if (values.shareholderId) {
        payload = {
          shareholderId: values.shareholderId,
          shareClassId: values.shareClassId,
          quantity: values.quantity,
          projectId: values.projectId,
        };
      } else {
        const beneficiaryToType: Record<string, string> = {
          self: 'INDIVIDUAL',
          family: 'MINOR',
          company: 'COMPANY',
          gift: 'INDIVIDUAL',
        };
        payload = {
          type: beneficiaryToType[values.beneficiaryType],
          firstName: values.firstName,
          lastName: values.lastName,
          birthDate: values.birthDate,
          companyName: values.companyName,
          companyId: values.companyId,
          vatNumber: values.vatNumber,
          email: values.email,
          phone: values.phone,
          address: {
            street: values.street,
            number: values.number,
            postalCode: values.postalCode,
            city: values.city,
            country: values.country,
          },
          shareClassId: values.shareClassId,
          quantity: values.quantity,
          projectId: values.projectId,
        };
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/channels/${channelSlug}/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Registration failed');
      }

      const data = await response.json();
      setResult({
        registrationId: data.registrationId,
        ogmCode: data.ogmCode,
      });
      setStep(STEP.PAYMENT);
    } catch (error) {
      console.error('Registration failed:', error);
      alert(error instanceof Error ? error.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!coop) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('errors.notFound')}</p>
      </div>
    );
  }

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="bg-white border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex justify-between max-w-2xl mx-auto">
          {steps.map((stepName, index) => (
            <div
              key={index}
              className={`flex items-center ${
                index < steps.length - 1 ? 'flex-1' : ''
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step > index + 1
                    ? 'bg-green-500 text-white'
                    : step === index + 1
                    ? 'text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
                style={
                  step === index + 1
                    ? { backgroundColor: coop.primaryColor }
                    : {}
                }
              >
                {step > index + 1 ? '✓' : index + 1}
              </div>
              <span className="ml-2 text-sm hidden sm:inline">{stepName}</span>
              {index < steps.length - 1 && (
                <div className="flex-1 h-px bg-border mx-4" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // STEP 1: DETAILS (existing shareholder picker OR beneficiary type + details)
  // ============================================================================
  const renderStep1ExistingUser = () => (
    <Card>
      <CardHeader>
        <CardTitle>{t('registration.buyingFor')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {allShareholders.map((sh) => (
            <div
              key={sh.id}
              className={`flex items-center space-x-3 border rounded-lg p-4 cursor-pointer hover:bg-accent ${
                selectedShareholder?.id === sh.id ? 'border-2' : ''
              }`}
              style={selectedShareholder?.id === sh.id ? { borderColor: coop.primaryColor } : {}}
              onClick={() => handleShareholderChange(sh.id)}
            >
              <div className="flex-1">
                <span className="font-medium">{getShareholderDisplayName(sh)}</span>
                {sh.type === 'COMPANY' && (
                  <span className="ml-2 text-sm text-muted-foreground">({t('shareholder.type.company')})</span>
                )}
                {sh.type === 'MINOR' && (
                  <span className="ml-2 text-sm text-muted-foreground">({t('shareholder.type.minor')})</span>
                )}
                <p className="text-sm text-muted-foreground">{sh.email}</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 ${
                  selectedShareholder?.id === sh.id ? 'border-4' : ''
                }`}
                style={selectedShareholder?.id === sh.id ? { borderColor: coop.primaryColor } : {}}
              />
            </div>
          ))}

          {/* Register someone new option */}
          <div
            className="flex items-center space-x-3 border rounded-lg p-4 cursor-pointer hover:bg-accent border-dashed"
            onClick={() => handleShareholderChange('new')}
          >
            <UserPlus className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <span className="font-medium">{t('registration.registerNewPerson')}</span>
              <p className="text-sm text-muted-foreground">{t('registration.registerNewPersonDescription')}</p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          className="w-full mt-6"
          style={{ backgroundColor: coop.primaryColor }}
          onClick={handleStep1Next}
          disabled={!selectedShareholder}
        >
          {t('common.next')}
        </Button>
      </CardContent>
    </Card>
  );

  const renderStep1NewUser = () => (
    <>
    <Card>
      <CardHeader>
        <CardTitle>{t('registration.beneficiaryType.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Beneficiary type selector */}
        <RadioGroup
          value={watchBeneficiaryType}
          onValueChange={(value) =>
            form.setValue(
              'beneficiaryType',
              value as 'self' | 'family' | 'company' | 'gift'
            )
          }
          className="space-y-3"
        >
          {(['self', 'family', 'company', 'gift'] as const).map((type) => (
            <div
              key={type}
              className="flex items-start space-x-3 border rounded-lg p-4 cursor-pointer hover:bg-accent"
            >
              <RadioGroupItem value={type} id={type} />
              <Label htmlFor={type} className="flex-1 cursor-pointer">
                <span className="font-medium">
                  {t(`registration.beneficiaryType.${type}`)}
                </span>
                <p className="text-sm text-muted-foreground">
                  {t(`registration.beneficiaryType.${type}Description`)}
                </p>
              </Label>
            </div>
          ))}
        </RadioGroup>

        {/* OAuth prefill buttons for non-logged-in self registrations */}
        {watchBeneficiaryType === 'self' && !isLoggedIn && (
          <div className="space-y-3">
            <div className="relative flex items-center">
              <div className="flex-grow border-t" />
              <span className="mx-3 text-sm text-muted-foreground">
                {t('registration.prefillWithOAuth')}
              </span>
              <div className="flex-grow border-t" />
            </div>
            <OAuthButtons brandColor={coop.primaryColor} mode="prefill" redirectPath={pathname} />
          </div>
        )}

        {/* Details form (inline, merged from old step 2) */}
        <div className="border-t pt-6 space-y-4">
          {/* Helper text for family/company */}
          {watchBeneficiaryType === 'family' && (
            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              {t('registration.familyHelperText')}
            </p>
          )}
          {watchBeneficiaryType === 'company' && (
            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              {t('registration.companyHelperText')}
            </p>
          )}

          {watchBeneficiaryType === 'gift' ? (
            /* Gift flow: explanation + buyer email only */
            <>
              <div className="flex items-start gap-3 bg-muted/50 p-4 rounded-md">
                <Gift className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {t('registration.giftExplanation')}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t('registration.giftBuyerEmail')} *</Label>
                <Input type="email" {...form.register('email')} />
              </div>
            </>
          ) : watchBeneficiaryType === 'company' ? (
            <>
              <div className="space-y-2">
                <Label>{t('shareholder.fields.companyName')} *</Label>
                <Input {...form.register('companyName')} />
              </div>
              <div className="space-y-2">
                <Label>{t('shareholder.fields.companyId')} *</Label>
                <Input {...form.register('companyId')} placeholder="0XXX.XXX.XXX" />
              </div>
              <div className="space-y-2">
                <Label>{t('shareholder.fields.vatNumber')}</Label>
                <Input {...form.register('vatNumber')} placeholder="BE0XXX.XXX.XXX" />
              </div>

              <div className="space-y-2">
                <Label>{t('common.email')} *</Label>
                <Input type="email" {...form.register('email')} />
              </div>

              <div className="space-y-2">
                <Label>{t('common.phone')}</Label>
                <Input type="tel" {...form.register('phone')} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>{t('common.street')} *</Label>
                  <Input {...form.register('street')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.houseNumber')} *</Label>
                  <Input {...form.register('number')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('common.postalCode')} *</Label>
                  <Input {...form.register('postalCode')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.city')} *</Label>
                  <Input {...form.register('city')} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('shareholder.fields.firstName')} *</Label>
                  <Input {...form.register('firstName')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('shareholder.fields.lastName')} *</Label>
                  <Input {...form.register('lastName')} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('shareholder.fields.birthDate')} *</Label>
                <DatePicker
                  value={form.watch('birthDate')}
                  onChange={(value) => form.setValue('birthDate', value || '')}
                  placeholder={t('shareholder.fields.birthDate')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('common.email')} *</Label>
                <Input type="email" {...form.register('email')} />
              </div>

              <div className="space-y-2">
                <Label>{t('common.phone')}</Label>
                <Input type="tel" {...form.register('phone')} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>{t('common.street')} *</Label>
                  <Input {...form.register('street')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.houseNumber')} *</Label>
                  <Input {...form.register('number')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('common.postalCode')} *</Label>
                  <Input {...form.register('postalCode')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.city')} *</Label>
                  <Input {...form.register('city')} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-4 mt-6">
          {allShareholders.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsRegisteringNew(false);
                setSelectedShareholder(allShareholders[0]);
                prefillFormWithShareholder(allShareholders[0]);
              }}
            >
              {t('common.back')}
            </Button>
          )}
          <Button
            type="button"
            className="flex-1"
            style={{ backgroundColor: coop.primaryColor }}
            onClick={handleStep1Next}
          >
            {t('common.next')}
          </Button>
        </div>
      </CardContent>
    </Card>

    {/* "Already a member? Log in" link for non-logged-in users */}
    {!isLoggedIn && (
      <p className="text-center text-sm text-muted-foreground mt-4">
        <Link
          href={`/${locale}/${coopSlug}/${channelSlug}/login`}
          className="underline hover:no-underline"
          style={{ color: coop.primaryColor }}
        >
          {t('registration.alreadyMember')}
        </Link>
      </p>
    )}
    </>
  );

  // ============================================================================
  // WELCOME STEP (new vs existing user gate)
  // ============================================================================
  const renderWelcomeStep = () => (
    <div className="space-y-4">
      {!showLoginForm ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* I'm new */}
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setStep(STEP.DETAILS)}
          >
            <CardContent className="pt-6 text-center space-y-3">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: `${coop.primaryColor}15`, color: coop.primaryColor }}
              >
                <UserPlus className="h-7 w-7" />
              </div>
              <h3 className="font-semibold text-lg">
                {t('registration.welcome.newTitle')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('registration.welcome.newDescription')}
              </p>
              <Button
                className="w-full"
                style={{ backgroundColor: coop.primaryColor }}
              >
                {t('common.next')}
              </Button>
            </CardContent>
          </Card>

          {/* I have an account */}
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setShowLoginForm(true)}
          >
            <CardContent className="pt-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
                <LogIn className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-lg">
                {t('registration.welcome.existingTitle')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('registration.welcome.existingDescription')}
              </p>
              <Button variant="outline" className="w-full">
                {t('auth.login')}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="max-w-md mx-auto space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLoginForm(false)}
          >
            &larr; {t('common.back')}
          </Button>
          <EmailFirstLogin
            coop={{
              name: coop.name,
              logoUrl: coop.logoUrl,
              primaryColor: coop.primaryColor,
              secondaryColor: coop.secondaryColor || coop.primaryColor,
              slug: coopSlug,
            }}
            onLoginSuccess={handleLoginSuccess}
          />
        </div>
      )}
    </div>
  );

  // ============================================================================
  // STEP 2: ORDER (shares + payment + summary + terms)
  // ============================================================================
  const renderStep2Order = () => (
    <Card>
      <CardHeader>
        <CardTitle>{t('registration.selectShareClass')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Share class selection */}
        <div className="space-y-2">
          <Label>{t('shares.shareClass')} *</Label>
          <Select
            value={watchShareClassId}
            onValueChange={(value) => form.setValue('shareClassId', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('registration.selectShareClass')} />
            </SelectTrigger>
            <SelectContent>
              {coop.shareClasses.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.name} ({sc.code}) - {formatCurrency(sc.pricePerShare)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {coop.projects.length > 0 && (
          <div className="space-y-2">
            <Label>{t('shares.project')}</Label>
            <Select
              value={form.watch('projectId') || ''}
              onValueChange={(value) => form.setValue('projectId', value || undefined)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('registration.selectProject')} />
              </SelectTrigger>
              <SelectContent>
                {coop.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label>{t('shares.quantity')} *</Label>
          <Input
            type="number"
            min={selectedShareClass?.minShares || 1}
            max={selectedShareClass?.maxShares}
            {...form.register('quantity', { valueAsNumber: true })}
          />
          {selectedShareClass && (
            <p className="text-sm text-muted-foreground">
              Min: {selectedShareClass.minShares}
              {selectedShareClass.maxShares && `, Max: ${selectedShareClass.maxShares}`}
            </p>
          )}
        </div>

        {selectedShareClass && (
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex justify-between text-lg font-semibold">
              <span>{t('common.total')}</span>
              <span style={{ color: coop.primaryColor }}>
                {formatCurrency(totalAmount)}
              </span>
            </div>
          </div>
        )}

        {/* Order summary */}
        <div className="bg-muted p-4 rounded-lg space-y-2">
          <h4 className="font-medium">{t('registration.orderSummary')}</h4>
          <div className="text-sm space-y-1">
            {selectedShareholder && (
              <div className="flex justify-between">
                <span>{t('registration.buyingFor')}</span>
                <span className="font-medium">{getShareholderDisplayName(selectedShareholder)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t('shares.shareClass')}</span>
              <span>{selectedShareClass?.name}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('shares.quantity')}</span>
              <span>{watchQuantity}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('shares.pricePerShare')}</span>
              <span>{formatCurrency(selectedShareClass?.pricePerShare || 0)}</span>
            </div>
            <div className="flex justify-between font-semibold pt-2 border-t">
              <span>{t('common.total')}</span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>

        {/* Terms */}
        <div className="flex items-start space-x-2">
          <Checkbox
            id="terms"
            checked={form.watch('acceptTerms') || false}
            onCheckedChange={(checked) =>
              form.setValue('acceptTerms', checked === true ? true : undefined as never)
            }
          />
          <Label htmlFor="terms" className="text-sm">
            {coop.termsUrl ? (
              <>
                {t('registration.acceptTermsPrefix')}{' '}
                <a
                  href={coop.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                  style={{ color: coop.primaryColor }}
                >
                  {t('registration.termsAndConditions')}
                </a>
              </>
            ) : (
              t('registration.acceptTerms')
            )}
          </Label>
        </div>

        <div className="flex gap-4 mt-6">
          <Button type="button" variant="outline" onClick={() => setStep(STEP.DETAILS)}>
            {t('common.back')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            style={{ backgroundColor: coop.primaryColor }}
            disabled={!form.watch('acceptTerms') || !watchShareClassId || watchQuantity < 1 || submitting}
            onClick={onSubmit}
          >
            {submitting ? t('common.loading') : t('registration.completeRegistration')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // ============================================================================
  // STEP 3: CONFIRMATION (success + EPC QR code + bank details)
  // ============================================================================
  const renderStep3Confirmation = () => (
    <Card>
      <CardHeader className="text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: coop.primaryColor }}
        >
          <span className="text-white text-2xl">✓</span>
        </div>
        <CardTitle>{t('registration.registrationComplete')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gift certificate section */}
        {result?.giftCode && (
          <div className="border rounded-lg p-6 space-y-4">
            <h4 className="font-medium text-center">{t('registration.giftCertificate')}</h4>
            <div className="flex flex-col items-center gap-4">
              <div
                className="text-2xl font-mono font-bold tracking-wider px-4 py-2 rounded-md"
                style={{ backgroundColor: `${coop.primaryColor}15`, color: coop.primaryColor }}
              >
                {result.giftCode}
              </div>
              <QRCodeSVG
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/${coopSlug}/${channelSlug}/claim?code=${result.giftCode}`}
                size={160}
                level="M"
              />
              <p className="text-sm text-muted-foreground text-center">
                {t('registration.giftShareWith')}
              </p>
              <p className="text-xs text-muted-foreground font-mono break-all text-center">
                {typeof window !== 'undefined' ? window.location.origin : ''}/{locale}/{coopSlug}/{channelSlug}/claim?code={result.giftCode}
              </p>
            </div>
          </div>
        )}

        {/* EPC QR code */}
        {coop.bankBic && coop.bankIban && (
          <div className="flex flex-col items-center py-4">
            <EpcQrCode
              bic={coop.bankBic}
              beneficiaryName={coop.name}
              iban={coop.bankIban}
              amount={totalAmount}
              reference={result?.ogmCode}
              size={180}
            />
            <p className="text-sm text-muted-foreground mt-2">
              {t('registration.scanToPay')}
            </p>
          </div>
        )}

        <div className="bg-muted p-4 rounded-lg space-y-3">
          <h4 className="font-medium">{t('payments.bankDetails')}</h4>
          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span>{t('payments.beneficiary')}</span>
              <span className="font-mono">{coop.name}</span>
            </div>
            {coop.bankIban && (
              <div className="flex justify-between">
                <span>{t('payments.iban')}</span>
                <span className="font-mono">{coop.bankIban}</span>
              </div>
            )}
            {coop.bankBic && (
              <div className="flex justify-between">
                <span>{t('payments.bic')}</span>
                <span className="font-mono">{coop.bankBic}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t('common.amount')}</span>
              <span className="font-semibold">{formatCurrency(totalAmount)}</span>
            </div>
            {result?.ogmCode && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span>{t('payments.ogmCode')}</span>
                <span
                  className="font-mono text-lg font-bold"
                  style={{ color: coop.primaryColor }}
                >
                  {result.ogmCode}
                </span>
              </div>
            )}
          </div>
        </div>

        {result && (
          <p className="text-sm text-muted-foreground mt-4 text-center">
            Registration ID: {result.registrationId}
          </p>
        )}
      </CardContent>
    </Card>
  );

  // ============================================================================
  // RENDER CURRENT STEP
  // ============================================================================
  const renderStep = () => {
    if (!isLoggedIn && step === STEP.WELCOME) {
      return renderWelcomeStep();
    }
    if (step === STEP.DETAILS) {
      return hasExistingShareholders ? renderStep1ExistingUser() : renderStep1NewUser();
    }
    if (step === STEP.ORDER) {
      return renderStep2Order();
    }
    if (step === STEP.PAYMENT) {
      return renderStep3Confirmation();
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            {coop.logoUrl ? (
              <img
                src={resolveLogoUrl(coop.logoUrl)!}
                alt={coop.name}
                className="h-10 object-contain"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: coop.primaryColor }}
              >
                <span className="text-white font-bold text-lg">
                  {coop.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1
                className="text-xl font-bold"
                style={{ color: coop.primaryColor }}
              >
                {coop.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('registration.title')}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Steps indicator */}
      {renderStepIndicator()}

      {/* Form */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={(e) => e.preventDefault()}>
            {renderStep()}
          </form>
        </div>
      </main>
    </div>
  );
}
