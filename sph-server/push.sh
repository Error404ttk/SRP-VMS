#!/bin/bash

# สีสำหรับการแสดงผลที่สวยงาม
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

clear
echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   🚀 SPH Vehicle Log - Git Push Helper Script        ${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "สคริปต์ช่วยนำโค้ด v2.0.0 ขึ้นสู่ GitHub ของคุณอย่างปลอดภัย"
echo -e ""

# ตรวจสอบว่ามีโฟลเดอร์ Git อยู่ตรงนี้หรือโฟลเดอร์แม่
if [ -d ".git" ]; then
    GIT_ROOT="."
elif [ -d "../.git" ]; then
    GIT_ROOT=".."
else
    echo -e "${RED}❌ ไม่พบความเชื่อมโยง Git ในโฟลเดอร์ปัจจุบันหรือโฟลเดอร์แม่ กรุณาเปิดใช้งานในไดเรกทอรีโครงการ${NC}"
    exit 1
fi

echo -e "${YELLOW}🔑 กรุณากรอก GitHub Personal Access Token (PAT) ของคุณ:${NC}"
echo -e "*(Token ของ GitHub มักขึ้นต้นด้วย ghp_ โดยจะไม่มีการบันทึกเก็บไว้ในโค้ด)*"
read -s -p "GitHub Token: " GITHUB_TOKEN
echo ""

PUSH_STATUS=1

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ คุณไม่ได้ระบุ Token จะทำการรันแบบปกติ และอาจมีการถามหา Username/Password อีกครั้ง${NC}"
    echo -e "${BLUE}🔄 กำลังดำเนินการตรวจสอบและ Push โค้ด...${NC}"
    git -C "$GIT_ROOT" push -f origin main
    PUSH_STATUS=$?
else
    echo -e "${BLUE}🔒 กำลังเชื่อมต่อยืนยันสิทธิ์กับ GitHub ด้วย Token...${NC}"
    # เซ็ตค่า URL รีโมทชั่วคราวที่มี Token ฝังอยู่
    git -C "$GIT_ROOT" remote set-url origin "https://${GITHUB_TOKEN}@github.com/Error404ttk/SRP-VMS.git"
    
    # ดำเนินการ Push โค้ดขึ้น GitHub
    git -C "$GIT_ROOT" push -f origin main
    PUSH_STATUS=$?
    
    # ทำการถอด Token ล้างออกจากรีโมทเพื่อความปลอดภัยสูงสุด (ล้างเหลือแบบ URL ปกติ)
    git -C "$GIT_ROOT" remote set-url origin "https://github.com/Error404ttk/SRP-VMS"
fi

if [ $PUSH_STATUS -eq 0 ]; then
    echo -e ""
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}  🎉 สำเร็จ! ซอร์สโค้ด SPH Vehicle Log ขึ้น GitHub แล้ว  ${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo -e "คุณสามารถไปตรวจสอบที่: https://github.com/Error404ttk/SRP-VMS"
else
    echo -e ""
    echo -e "${RED}❌ เกิดข้อผิดพลาดในการ Push กรุณาตรวจสอบว่ามี Token ที่ได้รับสิทธิ์เขียน (Write access) หรือไม่${NC}"
fi
