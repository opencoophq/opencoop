import { registrationErrorMessage } from './registration-error';

const closed = 'This cooperative is not accepting new registrations right now.';

describe('registrationErrorMessage', () => {
  it('shows the translated lapse message', () => {
    expect(registrationErrorMessage({ code: 'SIGNUP_CLOSED', message: 'English fallback' }, closed)).toBe(closed);
  });

  it('shows a specific API message for other failures', () => {
    expect(registrationErrorMessage({ message: 'You must accept the privacy policy' }, closed)).toBe(
      'You must accept the privacy policy',
    );
  });

  it('falls back when the body has no message', () => {
    expect(registrationErrorMessage({}, closed)).toBe('Registration failed');
    expect(registrationErrorMessage(null, closed)).toBe('Registration failed');
  });
});
