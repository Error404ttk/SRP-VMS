export function formatThaiDate(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return dateInput;
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

export function formatThaiDateTime(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return dateInput;
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear() + 543;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

export function isValidIsoDate(str) {
  if (!str) return false;
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(str);
}

export function isValidTimeValue(str) {
  if (!str) return false;
  return /^\d{2}:\d{2}$/.test(str);
}

export function parseThaiDateTime(str) {
  if (!str) return 0;
  
  // Split date and time parts
  const parts = String(str).trim().split(' ');
  const dateParts = parts[0].split('/');
  
  if (dateParts.length === 3) {
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    let year = parseInt(dateParts[2], 10);
    
    // If year is Buddhist era (typically > 2400), convert to Christian era (CE)
    if (year > 2400) {
      year -= 543;
    }
    
    let hours = 0, minutes = 0, seconds = 0;
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      hours = parseInt(timeParts[0] || 0, 10);
      minutes = parseInt(timeParts[1] || 0, 10);
      seconds = parseInt(timeParts[2] || 0, 10);
    }
    const d = new Date(year, month, day, hours, minutes, seconds);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  
  // Fallback to native Date parser
  const nativeTime = new Date(str).getTime();
  return isNaN(nativeTime) ? 0 : nativeTime;
}

