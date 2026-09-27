import axios from 'axios';

const isNetlifyOrProd =
  typeof window !== 'undefined' &&
  (window.location.hostname.includes('netlify.app') ||
   window.location.hostname !== 'localhost' ||
   import.meta.env.PROD);

const defaultBackendUrl = isNetlifyOrProd ? '' : 'http://localhost:4000';
const defaultIncidentUrl = isNetlifyOrProd ? '' : 'http://localhost:5000';

export const backendApi = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) ?? defaultBackendUrl,
});

export const incidentApi = axios.create({
  baseURL: (import.meta.env.VITE_INCIDENT_URL as string) ?? defaultIncidentUrl,
});

// Attach JWT to backend requests
backendApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
