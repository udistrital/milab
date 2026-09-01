function attachSessionMethods(sessionState) {
  Object.defineProperty(sessionState, 'regenerate', {
    configurable: true,
    enumerable: false,
    value(callback) {
      for (const key of Object.keys(sessionState)) {
        delete sessionState[key];
      }

      if (typeof callback === 'function') {
        callback(null);
      }
    },
  });

  Object.defineProperty(sessionState, 'destroy', {
    configurable: true,
    enumerable: false,
    value(callback) {
      for (const key of Object.keys(sessionState)) {
        delete sessionState[key];
      }

      if (typeof callback === 'function') {
        callback(null);
      }
    },
  });

  return sessionState;
}

function createSessionHarness(initialState = {}) {
  const state = attachSessionMethods({ ...initialState });

  return {
    state,
    attach(req) {
      req.session = state;
    },
  };
}

function createUser(overrides = {}) {
  return {
    id: 1,
    correo: 'admin@udistrital.edu.co',
    documento: '100',
    documento_real: '100',
    nombre: 'Usuario Demo',
    roles: ['admin'],
    tipo: 'admin',
    ...overrides,
  };
}

function createMicrosoftProfile(overrides = {}) {
  return {
    nombre: 'Persona Microsoft',
    correo: 'persona@udistrital.edu.co',
    microsoftId: 'ms-1',
    ...overrides,
  };
}

module.exports = {
  createMicrosoftProfile,
  createSessionHarness,
  createUser,
};
