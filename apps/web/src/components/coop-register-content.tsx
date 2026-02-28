'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
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
import { Gift, UserPlus } from 'lucide-react';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
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

export function CoopRegisterContent({ coopSlug }: { coopSlug: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
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
  const [result, setResult] = useState<{
    transactionId: string;
    ogmCode?: string;
    giftCode?: string;
  } | null>(null);

  // Determine if user has existing shareholders (short flow) or is new (long flow)
  const hasExistingShareholders = allShareholders.length > 0 && !isRegisteringNew;

  // Always 3 steps now
  const steps = [
    t('registration.steps.details'),
    t('registration.steps.order'),
    t('registration.steps.confirm'),
  ];
  const totalSteps = 3;

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
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/public-info`
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
  }, [coopSlug, preselectedClass, preselectedProject, preselectedShareholderId, form]);

  // Helper function to pre-fill form with shareholder data
  const prefillFormWithShareholder = (shareholder: ExistingShareholder) => {
    form.setValue('beneficiaryType', shareholder.type === 'COMPANY' ? 'company' : 'self');
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
      // Reset form for new registration
      form.reset({
        beneficiaryType: 'self',
        paymentMethod: 'BANK_TRANSFER',
        quantity: 1,
        country: 'Belgium',
      });
    } else {
      const shareholder = allShareholders.find(s => s.id === shareholderId);
      if (shareholder) {
        setSelectedShareholder(shareholder);
        prefillFormWithShareholder(shareholder);
      }
    }
  };

  // Navigate to next step
  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  // Validate step 1 fields before navigating to step 2
  const handleStep1Next = async () => {
    if (hasExistingShareholders) {
      // Existing shareholder selected — no form validation needed
      nextStep();
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
      nextStep();
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);

    try {
      // This would normally call the API
      // For now, simulate success
      const isGift = form.getValues('beneficiaryType') === 'gift';
      setResult({
        transactionId: 'TRX-' + Math.random().toString(36).substring(7),
        ogmCode: '+++123/4567/89012+++',
        ...(isGift && {
          giftCode: 'GIFT-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        }),
      });
      setStep(totalSteps);
    } catch (error) {
      console.error('Registration failed:', error);
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
          href={`/${locale}/${coopSlug}/login`}
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

        {/* Payment method */}
        <div className="border-t pt-4 space-y-4">
          <h4 className="font-medium">{t('registration.choosePaymentMethod')}</h4>
          <RadioGroup
            value={form.watch('paymentMethod')}
            onValueChange={(value) =>
              form.setValue(
                'paymentMethod',
                value as 'BANK_TRANSFER' | 'MOLLIE' | 'STRIPE'
              )
            }
            className="space-y-3"
          >
            <div className="flex items-center space-x-3 border rounded-lg p-4">
              <RadioGroupItem value="BANK_TRANSFER" id="bank" />
              <Label htmlFor="bank" className="flex-1 cursor-pointer">
                <span className="font-medium">
                  {t('payments.method.bankTransfer')}
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>

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
          <Button type="button" variant="outline" onClick={prevStep}>
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
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/${coopSlug}/claim?code=${result.giftCode}`}
                size={160}
                level="M"
              />
              <p className="text-sm text-muted-foreground text-center">
                {t('registration.giftShareWith')}
              </p>
              <p className="text-xs text-muted-foreground font-mono break-all text-center">
                {typeof window !== 'undefined' ? window.location.origin : ''}/{locale}/{coopSlug}/claim?code={result.giftCode}
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
            Transaction ID: {result.transactionId}
          </p>
        )}
      </CardContent>
    </Card>
  );

  // ============================================================================
  // RENDER CURRENT STEP
  // ============================================================================
  const renderStep = () => {
    switch (step) {
      case 1:
        return hasExistingShareholders ? renderStep1ExistingUser() : renderStep1NewUser();
      case 2:
        return renderStep2Order();
      case 3:
        return renderStep3Confirmation();
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header
        className="py-6"
        style={{ backgroundColor: coop.primaryColor }}
      >
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-white">{coop.name}</h1>
          <p className="text-white/80">{t('registration.title')}</p>
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
