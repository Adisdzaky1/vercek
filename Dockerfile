# Menggunakan base image Ubuntu 20.04
FROM ubuntu:20.04

# Install SSH dan sudo
RUN apt-get update && apt-get install -y openssh-server sudo

# Setup SSH
RUN mkdir /var/run/sshd && \
    echo 'root:password' | chpasswd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Buat user non-root
RUN useradd -m -s /bin/bash user && echo 'user:userpassword' | chpasswd && adduser user sudo

# Expose port SSH
EXPOSE 22

# Set ENTRYPOINT untuk menjalankan SSH daemon dalam mode foreground
ENTRYPOINT ["/usr/sbin/sshd", "-D"]

# CMD digunakan untuk menambahkan parameter default atau menjalankan script tambahan jika diperlukan
CMD []
