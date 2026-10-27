// Books come from the app (its library), not from Audiohub's cloud.
export const isCloudEbook = () => false;
export const loadCloudEbook = () => Promise.reject(new Error('Not available'));
